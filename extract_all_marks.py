import requests
import json
import csv
import sys
from concurrent.futures import ThreadPoolExecutor

# Semester map to convert integer IDs to Roman numerals needed for API
sem_map = {
    1: "I", 2: "II", 3: "III", 4: "IV",
    5: "V", 6: "VI", 7: "VII", 8: "VIII"
}

def fetch_btech_exams():
    url = "https://beu-bih.ac.in/backend/v1/result/sem-get"
    headers = {
        "Origin": "https://beu-bih.ac.in",
        "Referer": "https://beu-bih.ac.in/result-one",
        "User-Agent": "Mozilla/5.0"
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()

        btech_exams = []
        for course in data:
            if course['courseName'] == 'B.Tech':
                for exam in course['exams']:
                    if "(S)" not in exam['examName']:
                        btech_exams.append({
                            "examName": exam['examName'],
                            "semester_id": exam['semId'],
                            "session": exam['session'],
                            "exam_held": exam['examHeld'],
                            "batchYear": exam['batchYear']
                        })
        return btech_exams
    except Exception as e:
        print(f"Error fetching exams: {e}")
        return []

def fetch_student(args):
    reg_no, exam_info = args
    base_url = "https://beu-bih.ac.in/backend/v1/result/get-result"

    year = exam_info["session"][:4]
    if not year.isdigit():
        year = str(exam_info.get("batchYear", "2024"))

    params = {
        "year": year,
        "redg_no": str(reg_no),
        "semester": sem_map.get(exam_info["semester_id"], "I"),
        "exam_held": exam_info["exam_held"]
    }

    try:
        response = requests.get(base_url, params=params, timeout=10)
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
                    "fail_any": student_info.get("fail_any"),
                    "Exam_Name": exam_info["examName"],
                    "Session": exam_info["session"]
                }

                for subject in student_info.get("theorySubjects", []):
                    sub_name = subject.get("name")
                    if sub_name:
                        processed_student[f"{sub_name}_code"] = subject.get("code")
                        processed_student[f"{sub_name}_ese"] = subject.get("ese")
                        processed_student[f"{sub_name}_ia"] = subject.get("ia")
                        processed_student[f"{sub_name}_total"] = subject.get("total")
                        processed_student[f"{sub_name}_grade"] = subject.get("grade")
                        processed_student[f"{sub_name}_credit"] = subject.get("credit")

                for subject in student_info.get("practicalSubjects", []):
                    sub_name = subject.get("name")
                    if sub_name:
                        processed_student[f"{sub_name}_code"] = subject.get("code")
                        processed_student[f"{sub_name}_ese"] = subject.get("ese")
                        processed_student[f"{sub_name}_ia"] = subject.get("ia")
                        processed_student[f"{sub_name}_total"] = subject.get("total")
                        processed_student[f"{sub_name}_grade"] = subject.get("grade")
                        processed_student[f"{sub_name}_credit"] = subject.get("credit")

                return processed_student
    except Exception as e:
        pass
    return None

def main():
    print("Fetching regular B.Tech exams (excluding special/supplementary)...")
    btech_exams = fetch_btech_exams()
    if not btech_exams:
        print("No exams found.")
        sys.exit(1)

    print(f"Found {len(btech_exams)} regular exams.")

    # We will search a very broad range of colleges and courses to capture almost all students.
    # Note: Scanning this large of a range will take several minutes.
    valid_colleges = list(range(101, 175))
    common_courses = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113', '119', '151']

    tasks = []

    for exam in btech_exams:
        print(f"Queueing: {exam['examName']} (Session: {exam['session']})")
        session_str = exam['session']
        if len(session_str) >= 4 and session_str[:4].isdigit():
            year_prefix = session_str[2:4]
        else:
            year_prefix = str(exam.get("batchYear", "2024"))[2:4]

        for c_code in valid_colleges:
            for crs_code in common_courses:
                for roll in range(1, 65): # Broad roll numbers
                    reg = f"{year_prefix}{crs_code}{str(c_code).zfill(3)}{str(roll).zfill(3)}"
                    tasks.append((reg, exam))

    print(f"Total tasks to execute: {len(tasks)}")

    all_data = []
    all_subject_columns = set()

    # Process aggressively in the background.
    with ThreadPoolExecutor(max_workers=500) as executor:
        results = list(executor.map(fetch_student, tasks))

    for res in results:
        if res:
            all_data.append(res)
            for key in res.keys():
                if key not in ["Session", "Exam_Name", "regNo", "name", "father_name", "mother_name", "college_code", "college_name", "course_code", "course", "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any"]:
                    all_subject_columns.add(key)

    print(f"Successfully collected {len(all_data)} student records.")

    if not all_data:
        print("No data collected.")
        return

    basic_columns = [
        "Session", "Exam_Name", "regNo", "name", "father_name", "mother_name",
        "college_code", "college_name", "course_code", "course",
        "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any"
    ]

    sorted_subject_columns = sorted(list(all_subject_columns))
    all_columns = basic_columns + sorted_subject_columns

    with open('all_student_marks.csv', 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=all_columns)
        writer.writeheader()
        for row in all_data:
            writer.writerow(row)

    print("Saved all records to all_student_marks.csv")

if __name__ == "__main__":
    main()
