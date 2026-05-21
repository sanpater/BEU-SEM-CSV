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

VALID_COLLEGES = [
    101, 102, 103, 106, 107, 108, 109, 110, 111, 113, 114, 117, 118, 119,
    121, 122, 123, 124, 125, 126, 127, 130, 131, 132, 136, 141, 142, 143,
    144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 165,
    166, 167, 170
]

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


def main():
    print("Starting data extraction...")
    print("IMPORTANT: Existing CSV files will NOT be deleted.")
    print("Duplicate regNo rows will be skipped.\n")

    btech_exams = get_btech_exams()
    if not btech_exams:
        print("No B.Tech exams found.")
        return

    print(f"Found {len(btech_exams)} B.Tech exams to process.")

    for exam in btech_exams:
        exam_name = exam.get("examName", "Unknown Exam")
        session = exam.get("session", "")
        batch_year = exam.get("batchYear", "")
        exam_held = exam.get("examHeld", "")
        sem_id = exam.get("semId", 1)

        semester_roman = SEM_ROMAN[sem_id - 1] if 1 <= sem_id <= 8 else str(sem_id)

        try:
            start_year_str = session.split(" ")[0].split("-")[0]
        except Exception:
            start_year_str = ""

        prefix = start_year_str[2:] if len(start_year_str) == 4 else ""

        if not prefix:
            print(f"Skipping {exam_name}: invalid session/prefix: {session}")
            continue

        filename = f"{start_year_str}_sem{sem_id}.csv"
        _, _, already_saved_regnos = read_existing_csv(filename)

        print(f"\n--- Processing Exam: {exam_name} ---")
        print(f"Session: {session}, Prefix: {prefix}, Sem: {semester_roman}, Year: {batch_year}, Held: {exam_held}")
        print(f"File: {filename}")
        print(f"Already saved records in this file: {len(already_saved_regnos)}")

        tasks_to_check = [
            (prefix, crs_code, c_code, batch_year, semester_roman, exam_held, already_saved_regnos)
            for c_code in VALID_COLLEGES
            for crs_code in COMMON_COURSES
        ]

        all_new_data = []

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = [executor.submit(fetch_college_course, task) for task in tasks_to_check]

            completed = 0
            total = len(futures)

            for future in as_completed(futures):
                completed += 1
                try:
                    result_list = future.result()
                    all_new_data.extend(result_list)
                except Exception as e:
                    print(f"Task failed: {e}")

                if completed % 25 == 0 or completed == total:
                    print(f"Progress: {completed}/{total} college-course checks done | New found so far: {len(all_new_data)}")

        added_count, old_count, total_count = merge_and_save_csv(filename, all_new_data)

        print(f"Found new fetched records: {len(all_new_data)}")
        print(f"Added unique new records: {added_count}")
        print(f"Old records kept: {old_count}")
        print(f"Total records now in {filename}: {total_count}")

    generate_index_json()
    print("\nDone.")


if __name__ == "__main__":
    main()