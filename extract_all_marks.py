import requests
import json
import csv
import glob
import os
from concurrent.futures import ThreadPoolExecutor

def fetch_student(args):
    """Fetches a single student's data."""
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
                    "sgpa": student_info.get("sgpa", [None])[0] if student_info.get("sgpa") else None,
                    "cgpa": student_info.get("cgpa"),
                    "fail_any": student_info.get("fail_any")
                }

                # Extract Subjects
                for sub_type in ["theorySubjects", "practicalSubjects"]:
                    for subject in student_info.get(sub_type, []):
                        sub_name = subject.get("name")
                        if sub_name:
                            processed_student[f"{sub_name}_code"] = subject.get("code")
                            processed_student[f"{sub_name}_ese"] = subject.get("ese")
                            processed_student[f"{sub_name}_ia"] = subject.get("ia")
                            processed_student[f"{sub_name}_total"] = subject.get("total")
                            processed_student[f"{sub_name}_grade"] = subject.get("grade")
                            processed_student[f"{sub_name}_credit"] = subject.get("credit")

                return processed_student
    except Exception:
        pass
    return None

def fetch_college_course(args):
    """Worker function: Scans a specific course in a specific college and stops after 10 empty rolls."""
    prefix, crs_code, c_code, batch_year, semester_roman, exam_held = args
    results = []
    empty_count = 0
    
    for roll in range(1, 70): # Assuming max 150 students per branch
        reg = f"{prefix}{crs_code}{str(c_code).zfill(3)}{str(roll).zfill(3)}"
        student_data = fetch_student((reg, batch_year, semester_roman, exam_held))
        
        if student_data:
            results.append(student_data)
            empty_count = 0 # Reset counter when a student is found
        else:
            empty_count += 1
            if empty_count >= 10: # Stop checking this course/college after 10 fails
                break
                
    return results

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

    # Clean up existing batch CSVs
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

    # Full updated list of 45 colleges
    valid_colleges = [
        101, 102, 103, 106, 107, 108, 109, 110, 111, 113, 114, 117, 118, 119, 
        121, 122, 123, 124, 125, 126, 127, 130, 131, 132, 136, 141, 142, 143, 
        144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 165, 
        166, 167, 170
    ]
    common_courses = ['101', '102', '105', '110', '151', '119']
    sem_roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

    for exam in btech_exams:
        exam_name = exam.get("examName", "Unknown Exam")
        session = exam.get("session", "")
        batch_year = exam.get("batchYear", "")
        exam_held = exam.get("examHeld", "")
        sem_id = exam.get("semId", 1)

        semester_roman = sem_roman[sem_id - 1] if 1 <= sem_id <= 8 else str(sem_id)
        start_year_str = session.split(' ')[0].split('-')[0]
        prefix = start_year_str[2:] if len(start_year_str) == 4 else ""

        if not prefix:
            continue

        print(f"\n--- Processing Exam: {exam_name} ---")
        print(f"Session: {session}, Prefix: {prefix}, Sem: {semester_roman}, Year: {batch_year}, Held: {exam_held}")

        # Build tasks for the ThreadPool (each task is one college+course combo)
        tasks_to_check = []
        for c_code in valid_colleges:
            for crs_code in common_courses:
                tasks_to_check.append((prefix, crs_code, c_code, batch_year, semester_roman, exam_held))

        all_data = []
        all_subject_columns = set()

        # Run 200 combinations concurrently
        with ThreadPoolExecutor(max_workers=2000) as executor:
            lists_of_results = list(executor.map(fetch_college_course, tasks_to_check))

        # Flatten the list of lists and gather subject columns
        for result_list in lists_of_results:
            for student_dict in result_list:
                all_data.append(student_dict)
                for key in student_dict.keys():
                    if key not in ["regNo", "name", "father_name", "mother_name", "college_code", "college_name", "course_code", "course", "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any"]:
                        all_subject_columns.add(key)

        print(f"Successfully collected {len(all_data)} student records for {exam_name}.")

        if not all_data:
            continue

        # Correctly order columns (Basic Info first, then Subjects)
        basic_columns = [
            "regNo", "name", "father_name", "mother_name",
            "college_code", "college_name", "course_code", "course",
            "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any"
        ]
        sorted_subject_columns = sorted(list(all_subject_columns))
        all_columns = basic_columns + sorted_subject_columns

        filename = f"{start_year_str}_sem{sem_id}.csv"
        file_exists = os.path.isfile(filename)

        with open(filename, 'a' if file_exists else 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=all_columns)
            if not file_exists:
                writer.writeheader()
            for row in all_data:
                writer.writerow(row)

        print(f"Saved records to {filename}")

    # Generate index.json exactly as originally requested
    print("\nGenerating index.json for web UI...")
    index_data = []
    for csv_file in glob.glob("*_sem*.csv"):
        parts = csv_file.replace(".csv", "").split("_sem")
        if len(parts) == 2:
            index_data.append({
                "file": csv_file,
                "batch": parts[0],
                "semester": parts[1]
            })

    index_data.sort(key=lambda x: (-int(x["batch"]) if x["batch"].isdigit() else 0, int(x["semester"]) if x["semester"].isdigit() else 0))

    with open("index.json", "w", encoding="utf-8") as f:
        json.dump(index_data, f, indent=4)
    print("Saved index.json")

if __name__ == "__main__":
    main()
