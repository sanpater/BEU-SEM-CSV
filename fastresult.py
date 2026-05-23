import requests
import json
import csv
import glob
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import local, Lock

# ================== CONFIG ==================
BASE_URL = "https://beu-bih.ac.in/backend/v1/result/get-result"
EXAM_LIST_URL = "https://beu-bih.ac.in/backend/v1/result/sem-get"

# Load exact college + branch/course pairs from this JSON.
# Format supported:
# [
#   {
#     "college_code": "113",
#     "college_name": "...",
#     "branches": [{"course_code": "101", "course": "..."}]
#   }
# ]
COLLEGE_BRANCHES_JSON = os.environ.get("COLLEGE_BRANCHES_JSON", "college_branches.json")

# Default: process ALL B.Tech exams returned by BEU sem-get API, same as old code.
# Optional filters:
# TARGET_SEM_ID=1
# TARGET_SESSION=2025-29
# TARGET_EXAM_NAME="B.Tech 1st Semester Examination 2025"
# TARGET_COLLEGE_CODE=113
TARGET_SEM_ID = os.environ.get("TARGET_SEM_ID", "").strip()
TARGET_SESSION = os.environ.get("TARGET_SESSION", "").strip()
TARGET_EXAM_NAME = os.environ.get("TARGET_EXAM_NAME", "").strip()
TARGET_COLLEGE_CODE = os.environ.get("TARGET_COLLEGE_CODE", "").strip()

# Keep this reasonable. More workers = faster but more pressure on BEU server/network.
MAX_WORKERS = int(os.environ.get("MAX_WORKERS", "150"))

# Stop checking a branch/college after these many continuous missing roll numbers.
MAX_EMPTY_ROLLS = int(os.environ.get("MAX_EMPTY_ROLLS", "10"))

# Roll range: MAX_ROLL=70 checks 001 to 069, same behavior as old code.
MAX_ROLL = int(os.environ.get("MAX_ROLL", "70"))

# Print progress every N branch tasks.
PROGRESS_EVERY = int(os.environ.get("PROGRESS_EVERY", "25"))

BASIC_COLUMNS = [
    "regNo", "name", "father_name", "mother_name",
    "college_code", "college_name", "course_code", "course",
    "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any"
]

SEM_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]

_thread_local = local()
print_lock = Lock()


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

        if attempt < retries:
            time.sleep(0.35 * (attempt + 1))

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


def load_college_branch_tasks(json_file):
    """
    Load exact college+course pairs from college_branches.json.
    This replaces slow VALID_COLLEGES x COMMON_COURSES scanning.
    """
    if not os.path.isfile(json_file):
        raise FileNotFoundError(
            f"{json_file} not found. Put college_branches.json in the same folder "
            f"or set COLLEGE_BRANCHES_JSON=/path/to/file.json"
        )

    with open(json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    colleges = data.get("colleges", data) if isinstance(data, dict) else data

    pairs = []
    seen = set()

    for college in colleges:
        c_code = str(college.get("college_code", "")).strip().zfill(3)
        if not c_code or c_code == "000":
            continue

        if TARGET_COLLEGE_CODE and c_code != TARGET_COLLEGE_CODE.zfill(3):
            continue

        branches = college.get("branches", [])
        for branch in branches:
            crs_code = str(branch.get("course_code", "")).strip().zfill(3)
            if not crs_code or crs_code == "000":
                continue

            key = (c_code, crs_code)
            if key in seen:
                continue
            seen.add(key)

            pairs.append({
                "college_code": c_code,
                "college_name": college.get("college_name", ""),
                "course_code": crs_code,
                "course": branch.get("course", ""),
            })

    pairs.sort(key=lambda x: (int(x["college_code"]), int(x["course_code"])))
    return pairs


def fetch_college_course(args):
    """Scan a specific valid course in a specific valid college."""
    prefix, crs_code, c_code, batch_year, semester_roman, exam_held, already_saved_regnos = args
    results = []
    empty_count = 0
    checked_api = 0
    skipped_existing = 0

    for roll in range(1, MAX_ROLL):
        reg = f"{prefix}{crs_code}{c_code}{str(roll).zfill(3)}"

        # Already saved means do not fetch/write again.
        if reg in already_saved_regnos:
            skipped_existing += 1
            empty_count = 0
            continue

        checked_api += 1
        student_data = fetch_student((reg, batch_year, semester_roman, exam_held))

        if student_data:
            results.append(student_data)
            empty_count = 0
        else:
            empty_count += 1
            if empty_count >= MAX_EMPTY_ROLLS:
                break

    return {
        "college_code": c_code,
        "course_code": crs_code,
        "records": results,
        "checked_api": checked_api,
        "skipped_existing": skipped_existing,
    }


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


def exam_allowed(exam):
    if TARGET_SEM_ID and str(exam.get("semId", "")).strip() != TARGET_SEM_ID:
        return False

    if TARGET_SESSION and str(exam.get("session", "")).strip() != TARGET_SESSION:
        return False

    if TARGET_EXAM_NAME and TARGET_EXAM_NAME.lower() not in str(exam.get("examName", "")).lower():
        return False

    return True


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
    print("=" * 80)
    print("BEU FAST RESULT FETCHER")
    print("=" * 80)
    print("Mode: ALL B.Tech exams from BEU API")
    print("Optimization: college_branches.json exact college+branch pairs")
    print("IMPORTANT: Existing CSV files will NOT be deleted.")
    print("Duplicate regNo rows will be skipped.")
    print("=" * 80)

    college_branch_pairs = load_college_branch_tasks(COLLEGE_BRANCHES_JSON)
    if not college_branch_pairs:
        print("No college-branch pairs loaded. Check college_branches.json.")
        return

    print(f"Loaded college-branch pairs: {len(college_branch_pairs)} from {COLLEGE_BRANCHES_JSON}")

    if TARGET_COLLEGE_CODE:
        print(f"Filter active: TARGET_COLLEGE_CODE={TARGET_COLLEGE_CODE.zfill(3)}")
    if TARGET_SEM_ID:
        print(f"Filter active: TARGET_SEM_ID={TARGET_SEM_ID}")
    if TARGET_SESSION:
        print(f"Filter active: TARGET_SESSION={TARGET_SESSION}")
    if TARGET_EXAM_NAME:
        print(f"Filter active: TARGET_EXAM_NAME contains {TARGET_EXAM_NAME}")

    print(f"MAX_WORKERS={MAX_WORKERS}, MAX_ROLL={MAX_ROLL}, MAX_EMPTY_ROLLS={MAX_EMPTY_ROLLS}")
    print("=" * 80)

    btech_exams = get_btech_exams()
    if not btech_exams:
        print("No B.Tech exams found.")
        return

    filtered_exams = [exam for exam in btech_exams if exam_allowed(exam)]

    print(f"Found B.Tech exams from API: {len(btech_exams)}")
    print(f"Exams selected for processing: {len(filtered_exams)}")

    if not filtered_exams:
        print("No exams matched your filters.")
        return

    overall_added = 0
    overall_fetched = 0

    for exam_index, exam in enumerate(filtered_exams, start=1):
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

        print("\n" + "-" * 80)
        print(f"[{exam_index}/{len(filtered_exams)}] Processing Exam: {exam_name}")
        print(f"Session: {session}, Prefix: {prefix}, Sem: {semester_roman}, Year: {batch_year}, Held: {exam_held}")
        print(f"File: {filename}")
        print(f"Already saved records in this file: {len(already_saved_regnos)}")
        print(f"College-branch checks for this exam: {len(college_branch_pairs)}")
        print("-" * 80)

        tasks_to_check = [
            (
                prefix,
                pair["course_code"],
                pair["college_code"],
                batch_year,
                semester_roman,
                exam_held,
                already_saved_regnos,
            )
            for pair in college_branch_pairs
        ]

        all_new_data = []
        completed = 0
        total = len(tasks_to_check)
        api_checked_total = 0
        skipped_existing_total = 0
        active_branch_count = 0

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = [executor.submit(fetch_college_course, task) for task in tasks_to_check]

            for future in as_completed(futures):
                completed += 1

                try:
                    result = future.result()
                    result_list = result["records"]
                    api_checked_total += result["checked_api"]
                    skipped_existing_total += result["skipped_existing"]

                    if result_list:
                        active_branch_count += 1
                        all_new_data.extend(result_list)
                        with print_lock:
                            print(
                                f"[FOUND] College {result['college_code']} | "
                                f"Branch {result['course_code']} | "
                                f"new={len(result_list)} | "
                                f"new total so far={len(all_new_data)}"
                            )

                except Exception as e:
                    with print_lock:
                        print(f"Task failed: {e}")

                if completed % PROGRESS_EVERY == 0 or completed == total:
                    print(
                        f"[PROGRESS] {completed}/{total} college-branch checks done | "
                        f"new found={len(all_new_data)} | "
                        f"active branches={active_branch_count} | "
                        f"API checked={api_checked_total} | "
                        f"skipped existing={skipped_existing_total}"
                    )

        added_count, old_count, total_count = merge_and_save_csv(filename, all_new_data)

        overall_fetched += len(all_new_data)
        overall_added += added_count

        print("\n" + "=" * 80)
        print("EXAM SUMMARY")
        print("=" * 80)
        print(f"Exam: {exam_name}")
        print(f"File: {filename}")
        print(f"Fetched new records from API: {len(all_new_data)}")
        print(f"Added unique new records: {added_count}")
        print(f"Old records kept: {old_count}")
        print(f"Total records now in {filename}: {total_count}")
        print(f"Active branches found in this run: {active_branch_count}")
        print(f"API requests made after skipping existing: {api_checked_total}")
        print(f"Existing regNos skipped: {skipped_existing_total}")
        print("=" * 80)

    generate_index_json()

    print("\n" + "=" * 80)
    print("FINAL ALL-EXAM SUMMARY")
    print("=" * 80)
    print(f"Exams processed: {len(filtered_exams)}")
    print(f"Total fetched records from API: {overall_fetched}")
    print(f"Total unique records added: {overall_added}")
    print("Done.")
    print("=" * 80)


if __name__ == "__main__":
    main()