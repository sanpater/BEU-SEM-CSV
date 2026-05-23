import requests
import json
import csv
import glob
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import local

# ================== CONFIG ==================
BASE_URL = "https://beu-bih.ac.in/backend/v1/result/get-result"
EXAM_LIST_URL = "https://beu-bih.ac.in/backend/v1/result/sem-get"

# Keep this reasonable. 2000 workers can crash your PC / get blocked by server.
MAX_WORKERS = int(os.environ.get("MAX_WORKERS", "100"))

# Stop checking a branch/college after these many continuous missing roll numbers.
MAX_EMPTY_ROLLS = int(os.environ.get("MAX_EMPTY_ROLLS", "10"))

# Roll range: range(1, 70) checks 001 to 069.
MAX_ROLL = int(os.environ.get("MAX_ROLL", "70"))

BASIC_COLUMNS = [
    "regNo", "name", "father_name", "mother_name",
    "college_code", "college_name", "course_code", "course",
    "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any"
]

VALID_COLLEGES = [149]  # Target only college code 113

COMMON_COURSES = ["101", "102", "105", "110", "151", "119"]
SEM_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]

_thread_local = local()


def get_session():
    """One requests.Session per thread for faster repeated requests."""
    if not hasattr(_thread_local, "session"):
        s = requests.Session()
        s.headers.update({
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,text/plain,*/*",
            "Connection": "keep-alive",
        })
        _thread_local.session = s
    return _thread_local.session


def fetch_json(url, params=None, timeout=10, retries=2):
    """Small retry wrapper for unstable network/server responses."""
    last_error = None

    for attempt in range(retries + 1):
        try:
            response = get_session().get(url, params=params, timeout=timeout)
            if response.status_code == 200:
                return response.json()

            last_error = f"HTTP {response.status_code}"
        except Exception as e:
            last_error = str(e)

        # short backoff
        if attempt < retries:
            time.sleep(0.4 * (attempt + 1))

    return None


def safe_sgpa(student_info):
    sgpa = student_info.get("sgpa")
    if isinstance(sgpa, list) and sgpa:
        return sgpa[0]
    return sgpa


def fetch_student(args):
    """Fetch a single student's data."""
    reg_no, year, semester, exam_held = args
    params = {
        "year": str(year),
        "redg_no": str(reg_no),
        "semester": str(semester),
        "exam_held": str(exam_held),
    }

    data = fetch_json(BASE_URL, params=params, timeout=8, retries=2)
    if not data:
        return None

    if data.get("status") != 200 or not data.get("data"):
        return None

    student_info = data["data"]

    processed_student = {
        "regNo": student_info.get("redg_no"),
        "name": student_info.get("name"),
        "father_name": student_info.get("father_name"),
        "mother_name": student_info.get("mother_name"),
        "college_code": student_info.get("college_code"),
        "college_name": student_info.get("college_name"),
        "course_code": student_info.get("course_code"),
        "course": student_info.get("course"),
        "semester": student_info.get("semester"),
        "exam_held": student_info.get("exam_held"),
        "examYear": student_info.get("examYear"),
        "sgpa": safe_sgpa(student_info),
        "cgpa": student_info.get("cgpa"),
        "fail_any": student_info.get("fail_any"),
    }

    # Extract theory + practical subject marks.
    for sub_type in ["theorySubjects", "practicalSubjects"]:
        for subject in student_info.get(sub_type, []):
            sub_name = subject.get("name")
            if not sub_name:
                continue

            processed_student[f"{sub_name}_code"] = subject.get("code")
            processed_student[f"{sub_name}_ese"] = subject.get("ese")
            processed_student[f"{sub_name}_ia"] = subject.get("ia")
            processed_student[f"{sub_name}_total"] = subject.get("total")
            processed_student[f"{sub_name}_grade"] = subject.get("grade")
            processed_student[f"{sub_name}_credit"] = subject.get("credit")

    return processed_student


def fetch_college_course(args):
    """Scan a specific course in a specific college."""
    prefix, crs_code, c_code, batch_year, semester_roman, exam_held, already_saved_regnos = args
    results = []
    empty_count = 0

    for roll in range(1, MAX_ROLL):
        reg = f"{prefix}{crs_code}{str(c_code).zfill(3)}{str(roll).zfill(3)}"

        # Already saved means do not fetch/write again.
        if reg in already_saved_regnos:
            empty_count = 0
            continue

        student_data = fetch_student((reg, batch_year, semester_roman, exam_held))

        if student_data:
            results.append(student_data)
            empty_count = 0
        else:
            empty_count += 1
            if empty_count >= MAX_EMPTY_ROLLS:
                break

    return results


def get_btech_exams():
    print("Fetching list of B.Tech exams from API...")
    data = fetch_json(EXAM_LIST_URL, timeout=15, retries=3)

    if not data:
        print("Error: Could not fetch exam list.")
        return []

    for c in data:
        if c.get("courseName") == "B.Tech":
            return c.get("exams", [])

    return []


def read_existing_csv(filename):
    """
    Read existing CSV safely.
    This protects old saved data and gives us existing regNos for duplicate skipping.
    """
    if not os.path.isfile(filename):
        return [], [], set()

    rows = []
    existing_columns = []
    existing_regnos = set()

    with open(filename, "r", newline="", encoding="utf-8") as csvfile:
        reader = csv.DictReader(csvfile)
        existing_columns = reader.fieldnames or []

        for row in reader:
            rows.append(row)
            reg_no = row.get("regNo")
            if reg_no:
                existing_regnos.add(str(reg_no))

    return rows, existing_columns, existing_regnos


def merge_and_save_csv(filename, new_rows):
    """
    Preserve existing CSV rows, add only new rows, and rewrite with union columns.
    This avoids deleting old data and avoids duplicate regNo entries.
    """
    existing_rows, existing_columns, existing_regnos = read_existing_csv(filename)

    unique_new_rows = []
    for row in new_rows:
        reg_no = row.get("regNo")
        if not reg_no:
            continue

        reg_no = str(reg_no)
        if reg_no in existing_regnos:
            continue

        unique_new_rows.append(row)
        existing_regnos.add(reg_no)

    if not existing_rows and not unique_new_rows:
        return 0, len(existing_rows), 0

    # Union of old columns + new columns.
    all_subject_columns = set()

    for col in existing_columns:
        if col not in BASIC_COLUMNS:
            all_subject_columns.add(col)

    for row in unique_new_rows:
        for col in row.keys():
            if col not in BASIC_COLUMNS:
                all_subject_columns.add(col)

    all_columns = BASIC_COLUMNS + sorted(all_subject_columns)

    # Preserve any unknown old columns too.
    for col in existing_columns:
        if col not in all_columns:
            all_columns.append(col)

    all_rows = existing_rows + unique_new_rows

    with open(filename, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=all_columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_rows)

    return len(unique_new_rows), len(existing_rows), len(all_rows)


def generate_index_json():
    print("\nGenerating index.json for web UI...")
    index_data = []

    for csv_file in glob.glob("*_sem*.csv"):
        parts = csv_file.replace(".csv", "").split("_sem")
        if len(parts) == 2:
            index_data.append({
                "file": csv_file,
                "batch": parts[0],
                "semester": parts[1],
            })

    index_data.sort(
        key=lambda x: (
            -int(x["batch"]) if str(x["batch"]).isdigit() else 0,
            int(x["semester"]) if str(x["semester"]).isdigit() else 0,
        )
    )

    with open("index.json", "w", encoding="utf-8") as f:
        json.dump(index_data, f, indent=4)

    print("Saved index.json")



# ================== TARGET EXAM ONLY ==================
# This script will process ONLY this exam:
# --- Processing Exam: B.Tech 1st Semester Examination 2025 ---
TARGET_EXAM = {
    "exam_name": "B.Tech 1st Semester Examination 2025",
    "session": "2025-29",
    "start_year": "2025",
    "prefix": "25",
    "sem_id": 1,
    "semester_roman": "I",
    "batch_year": "2025",
    "exam_held": "January/2026",
    "filename": "2025_sem1.csv",
}


def print_terminal_header(already_saved_count):
    print("\n--- Processing Exam: B.Tech 1st Semester Examination 2025 ---")
    print("Session: 2025-29, Prefix: 25, Sem: I, Year: 2025, Held: January/2026")
    print("File: 2025_sem1.csv")
    print("College code: 113 only")
    print(f"Already saved records in this file: {already_saved_count}")
    print("-" * 70)


def main():
    print("Starting data extraction...")
    print("Mode: TARGET EXAM ONLY + COLLEGE CODE 113 ONLY")
    print("Existing CSV file will NOT be deleted.")
    print("Duplicate regNo rows will be skipped.\n")

    prefix = TARGET_EXAM["prefix"]
    batch_year = TARGET_EXAM["batch_year"]
    semester_roman = TARGET_EXAM["semester_roman"]
    exam_held = TARGET_EXAM["exam_held"]
    filename = TARGET_EXAM["filename"]

    existing_rows, existing_columns, already_saved_regnos = read_existing_csv(filename)

    print_terminal_header(len(already_saved_regnos))

    tasks_to_check = [
        (prefix, crs_code, c_code, batch_year, semester_roman, exam_held, already_saved_regnos)
        for c_code in VALID_COLLEGES
        for crs_code in COMMON_COURSES
    ]

    print("Target college codes: 113")
    print(f"Total college-course checks: {len(tasks_to_check)}")
    print(f"Max workers: {MAX_WORKERS}")
    print(f"Roll range: 001 to {MAX_ROLL - 1:03d}")
    print(f"Stop after continuous empty rolls: {MAX_EMPTY_ROLLS}")
    print("-" * 70)

    all_new_data = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(fetch_college_course, task) for task in tasks_to_check]

        completed = 0
        total = len(futures)

        for future in as_completed(futures):
            completed += 1

            try:
                result_list = future.result()
                if result_list:
                    all_new_data.extend(result_list)
                    print(
                        f"[FOUND] Task {completed}/{total} returned {len(result_list)} new record(s) | "
                        f"New found so far: {len(all_new_data)}"
                    )
            except Exception as e:
                print(f"[ERROR] Task failed: {e}")

            if completed % 25 == 0 or completed == total:
                print(
                    f"[PROGRESS] {completed}/{total} college-course checks done | "
                    f"New found so far: {len(all_new_data)}"
                )

    added_count, old_count, total_count = merge_and_save_csv(filename, all_new_data)

    print("\n" + "=" * 70)
    print("FINAL RESPONSE")
    print("=" * 70)
    print(f"Exam processed: {TARGET_EXAM['exam_name']}")
    print(f"Session: {TARGET_EXAM['session']}")
    print(f"Semester: {TARGET_EXAM['semester_roman']}")
    print(f"Year: {TARGET_EXAM['batch_year']}")
    print(f"Held: {TARGET_EXAM['exam_held']}")
    print(f"Output file: {filename}")
    print("College code processed: 113 only")
    print(f"Already saved before run: {len(already_saved_regnos)}")
    print(f"Fetched new records from API: {len(all_new_data)}")
    print(f"Added unique new records: {added_count}")
    print(f"Old records kept: {old_count}")
    print(f"Total records now in {filename}: {total_count}")
    print("=" * 70)

    generate_index_json()
    print("\nDone.")


if __name__ == "__main__":
    main()