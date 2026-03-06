import requests
import json
import csv
from concurrent.futures import ThreadPoolExecutor

def fetch_student(reg_no):
    base_url = "https://beu-bih.ac.in/backend/v1/result/get-result"
    params = {
        "year": "2024",
        "redg_no": str(reg_no),
        "semester": "I",
        "exam_held": "May/2025"
    }

    try:
        response = requests.get(base_url, params=params, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == 200 and data.get("data"):
                student_info = data["data"]

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
                    "sgpa": student_info.get("sgpa", [None])[0] if student_info.get("sgpa") else None,
                    "cgpa": student_info.get("cgpa"),
                    "fail_any": student_info.get("fail_any")
                }

                # Theory Subjects
                for subject in student_info.get("theorySubjects", []):
                    sub_name = subject.get("name")
                    if sub_name:
                        processed_student[f"{sub_name}_code"] = subject.get("code")
                        processed_student[f"{sub_name}_ese"] = subject.get("ese")
                        processed_student[f"{sub_name}_ia"] = subject.get("ia")
                        processed_student[f"{sub_name}_total"] = subject.get("total")
                        processed_student[f"{sub_name}_grade"] = subject.get("grade")
                        processed_student[f"{sub_name}_credit"] = subject.get("credit")

                # Practical Subjects
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
    print("Starting data extraction...")

    # Fast path: test only the specific colleges & courses requested or known valid
    # Based on previous output, here is an optimized list to avoid huge delay
    valid_colleges = [102, 103, 106, 107, 108, 109, 110, 111, 113, 117, 118, 119, 122, 123, 124, 125, 130, 144, 146, 170]
    # To prevent extreme runtime, limit number of courses/colleges checked if needed, but we try all
    common_courses = ['101', '102', '105', '110', '151', '119'] # Added 119 for 113

    # We will just generate registrations for ALL valid colleges x common courses x roll 1 to 65
    regs_to_check = []
    for c_code in valid_colleges:
        for crs_code in common_courses:
            for roll in range(1, 66):
                reg = f"24{crs_code}{str(c_code).zfill(3)}{str(roll).zfill(3)}"
                regs_to_check.append(reg)

    print(f"Total registration numbers to query: {len(regs_to_check)}")

    all_data = []
    all_subject_columns = set()

    # High worker count without sleep (as requested)
    with ThreadPoolExecutor(max_workers=200) as executor:
        results = list(executor.map(fetch_student, regs_to_check))

    for res in results:
        if res:
            all_data.append(res)
            for key in res.keys():
                if key not in ["regNo", "name", "father_name", "mother_name", "college_code", "college_name", "course_code", "course", "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any"]:
                    all_subject_columns.add(key)

    print(f"Successfully collected {len(all_data)} student records.")

    if not all_data:
        print("No data collected.")
        return

    # Write to CSV
    basic_columns = [
        "regNo", "name", "father_name", "mother_name",
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
