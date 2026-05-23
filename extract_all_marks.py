import requests
import json
import csv
from concurrent.futures import ThreadPoolExecutor

def fetch_student(args):
    reg_no, year, semester, exam_held = args
    base_url = "https://beu-bih.ac.in/backend/v1/result/get-result"
    params = {
        "year": str(year),
        "redg_no": str(reg_no),
        "semester": str(semester),
        "exam_held": str(exam_held)
    }

    try:
        response = requests.get(base_url, params=params, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == 200 and data.get("data"):
                student_info = data["data"]

                # Map semester roman numeral to index 0-7
                sem_map = {"I": 0, "II": 1, "III": 2, "IV": 3, "V": 4, "VI": 5, "VII": 6, "VIII": 7}
                sem_str = student_info.get("semester", "")
                sem_idx = sem_map.get(sem_str.upper(), 0)

                # Extract the correct SGPA for the current semester from the array
                sgpa_array = student_info.get("sgpa", [])
                current_sgpa = None
                if sgpa_array and len(sgpa_array) > sem_idx:
                    current_sgpa = sgpa_array[sem_idx]

                # If missing at that index for some reason, try first non-null
                if current_sgpa is None and sgpa_array:
                    for s in sgpa_array:
                        if s is not None:
                            current_sgpa = s
                            break

                # Basic info
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
                    "sgpa": current_sgpa,
                    "cgpa": student_info.get("cgpa"),
                    "fail_any": student_info.get("fail_any")
                }

                # Store all historical SGPAs if they exist
                for i in range(8):
                    val = sgpa_array[i] if sgpa_array and len(sgpa_array) > i else None
                    processed_student[f"sgpa_{i+1}"] = val

                # Theory Subjects (prepend T_ to column names to distinguish)
                for subject in student_info.get("theorySubjects", []):
                    sub_name = subject.get("name")
                    if sub_name:
                        processed_student[f"T_{sub_name}_code"] = subject.get("code")
                        processed_student[f"T_{sub_name}_ese"] = subject.get("ese")
                        processed_student[f"T_{sub_name}_ia"] = subject.get("ia")
                        processed_student[f"T_{sub_name}_total"] = subject.get("total")
                        processed_student[f"T_{sub_name}_grade"] = subject.get("grade")
                        processed_student[f"T_{sub_name}_credit"] = subject.get("credit")

                # Practical Subjects (prepend P_ to column names to distinguish)
                for subject in student_info.get("practicalSubjects", []):
                    sub_name = subject.get("name")
                    if sub_name:
                        processed_student[f"P_{sub_name}_code"] = subject.get("code")
                        processed_student[f"P_{sub_name}_ese"] = subject.get("ese")
                        processed_student[f"P_{sub_name}_ia"] = subject.get("ia")
                        processed_student[f"P_{sub_name}_total"] = subject.get("total")
                        processed_student[f"P_{sub_name}_grade"] = subject.get("grade")
                        processed_student[f"P_{sub_name}_credit"] = subject.get("credit")

                return processed_student
    except Exception as e:
        pass
    return None

def get_btech_exams():
    print("Fetching list of B.Tech exams from API...")
    url = "https://beu-bih.ac.in/backend/v1/result/sem-get"
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            for c in data:
                if c.get("courseName") == "B.Tech":
                    return c.get("exams", [])
    except Exception as e:
        print(f"Error fetching exams: {e}")
    return []

def main():
    print("Starting data extraction...")

    # Clean up existing batch CSVs before running
    import glob
    import os
    for csv_file in glob.glob("*_sem*.csv"):
        try:
            os.remove(csv_file)
        except OSError:
            pass

    btech_exams = get_btech_exams()
    if not btech_exams:
        print("No B.Tech exams found.")
        return

    print(f"Found {len(btech_exams)} B.Tech exams to process.")

    # Comprehensive list of BEU College Codes
    valid_colleges = [
        102, 103, 106, 107, 108, 109, 110, 111, 113, 117, 118, 119, 122, 123, 124, 125,
        126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 139, 140, 141, 142, 144,
        145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 165,
        166, 167, 169, 170
    ]

    # Comprehensive list of BEU Branch Codes
    common_courses = [
        '101', '102', '103', '104', '105', '106', '107', '110', '111', '112', '113', '114',
        '115', '116', '117', '118', '119', '124', '125', '151', '152', '153', '154', '155',
        '156', '157', '158', '159', '160', '161', '162', '163', '164', '165', '166', '167'
    ]
    sem_roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

    for exam in btech_exams:
        exam_name = exam.get("examName", "Unknown Exam")
        session = exam.get("session", "")
        batch_year = exam.get("batchYear", "")
        exam_held = exam.get("examHeld", "")
        sem_id = exam.get("semId", 1)

        # Get roman numeral for semester
        semester_roman = sem_roman[sem_id - 1] if 1 <= sem_id <= 8 else str(sem_id)

        # Extract prefix from session (e.g. '2021-25' -> '21')
        start_year_str = session.split(' ')[0].split('-')[0] # '2023-27 (YBL)' -> '2023'
        prefix = start_year_str[2:] if len(start_year_str) == 4 else ""

        if not prefix:
            print(f"Could not determine prefix for session: {session}, skipping {exam_name}")
            continue

        print(f"\n--- Processing Exam: {exam_name} ---")
        print(f"Session: {session}, Prefix: {prefix}, Sem: {semester_roman}, Year: {batch_year}, Held: {exam_held}")

        regs_to_check = []
        for c_code in valid_colleges:
            for crs_code in common_courses:
                for roll in range(1, 66):
                    reg = f"{prefix}{crs_code}{str(c_code).zfill(3)}{str(roll).zfill(3)}"
                    # Package args for worker
                    regs_to_check.append((reg, batch_year, semester_roman, exam_held))

        print(f"Total registration numbers to query for this exam: {len(regs_to_check)}")

        all_data = []
        all_subject_columns = set()

        # High worker count without sleep (as requested)
        with ThreadPoolExecutor(max_workers=200) as executor:
            results = list(executor.map(fetch_student, regs_to_check))

        for res in results:
            if res:
                all_data.append(res)
                for key in res.keys():
                    if key not in ["regNo", "name", "father_name", "mother_name", "college_code", "college_name", "course_code", "course", "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any", "sgpa_1", "sgpa_2", "sgpa_3", "sgpa_4", "sgpa_5", "sgpa_6", "sgpa_7", "sgpa_8"]:
                        all_subject_columns.add(key)

        print(f"Successfully collected {len(all_data)} student records for {exam_name}.")

        if not all_data:
            print(f"No data collected for {exam_name}.")
            continue

        # Write to CSV
        basic_columns = [
            "regNo", "name", "father_name", "mother_name",
            "college_code", "college_name", "course_code", "course",
            "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any",
            "sgpa_1", "sgpa_2", "sgpa_3", "sgpa_4", "sgpa_5", "sgpa_6", "sgpa_7", "sgpa_8"
        ]

        sorted_subject_columns = sorted(list(all_subject_columns))
        all_columns = basic_columns + sorted_subject_columns

        # Exact filename requested: {start_year}_sem{sem_id}.csv (e.g. 2021_sem1.csv)
        filename = f"{start_year_str}_sem{sem_id}.csv"

        import os
        import csv

        file_exists = os.path.isfile(filename)

        if file_exists:
            # If the file already exists, we must merge headers to avoid corruption
            existing_data = []
            existing_headers = []
            with open(filename, 'r', newline='', encoding='utf-8') as infile:
                reader = csv.DictReader(infile)
                existing_headers = reader.fieldnames if reader.fieldnames else []
                existing_data = list(reader)

            merged_headers = list(dict.fromkeys(existing_headers + all_columns))
            merged_data = existing_data + all_data

            with open(filename, 'w', newline='', encoding='utf-8') as outfile:
                writer = csv.DictWriter(outfile, fieldnames=merged_headers)
                writer.writeheader()
                for row in merged_data:
                    writer.writerow(row)
        else:
            with open(filename, 'w', newline='', encoding='utf-8') as outfile:
                writer = csv.DictWriter(outfile, fieldnames=all_columns)
                writer.writeheader()
                for row in all_data:
                    writer.writerow(row)

        print(f"Saved records to {filename}")

    # Generate an index.json of all generated CSVs for the web UI
    print("Generating index.json for web UI...")
    index_data = []
    import glob
    for csv_file in glob.glob("*_sem*.csv"):
        parts = csv_file.replace(".csv", "").split("_sem")
        if len(parts) == 2:
            batch = parts[0]
            sem = parts[1]
            index_data.append({
                "file": csv_file,
                "batch": batch,
                "semester": sem
            })

    # Sort index data by batch descending, then semester ascending
    index_data.sort(key=lambda x: (-int(x["batch"]) if x["batch"].isdigit() else 0, int(x["semester"]) if x["semester"].isdigit() else 0))

    with open("index.json", "w", encoding="utf-8") as f:
        json.dump(index_data, f, indent=4)
    print("Saved index.json")

if __name__ == "__main__":
    main()
