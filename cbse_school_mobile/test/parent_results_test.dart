import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:flutter_test/flutter_test.dart";

// Shapes match apps/web/src/lib/parentResults.ts (ParentChildResults,
// ParentReportCardView) and buildParentDateSheet.
void main() {
  group("parent results", () {
    test("a released card parses with what the report card shows", () {
      final r = ParentResults.fromJson(const {
        "releasedTermCount": 2,
        "children": [
          {
            "studentId": "stu_1",
            "fullName": "Aarav Singh",
            "classLabel": "V-A",
            "terms": [
              {
                "termId": "term_ut1",
                "termCode": "UT1",
                "termLabel": "Unit Test 1",
                "academicYearCode": "2026-27",
                "releasedAt": "2026-10-13T10:00:00Z",
                "status": "no_marks",
                "message": "Marks for this exam are not ready yet.",
                "card": null,
                "printable": null,
              },
              {
                "termId": "term_hy",
                "termCode": "HY",
                "termLabel": "Half-yearly",
                "academicYearCode": "2026-27",
                "releasedAt": "2026-10-13T10:00:00Z",
                "status": "ready",
                "message": "",
                "printable": {"ignored": true},
                "card": {
                  "title": "Report Card",
                  "termLabel": "Half-yearly",
                  "academicYearCode": "2026-27",
                  "aggregateMode": "hy",
                  "gradesOnly": false,
                  "descriptors": false,
                  "subjects": [
                    {
                      "subjectId": "sub_eng",
                      "name": "English",
                      "maxMarks": 100,
                      "obtained": 72.5,
                      "grade": "B1",
                      "gradeLabel": "",
                      "absent": false,
                      "remark": "Reads well",
                      "parts": [
                        {
                          "code": "TE",
                          "label": "Written",
                          "maxMarks": 80,
                          "obtained": 56.5,
                        },
                        {
                          "code": "OR",
                          "label": "Oral",
                          "maxMarks": 20,
                          "obtained": null,
                        },
                      ],
                      "gradedParts": [
                        {"label": "Handwriting", "grade": "A"},
                        {"label": "Neatness", "grade": null},
                      ],
                    },
                    {
                      "subjectId": "sub_mat",
                      "name": "Mathematics",
                      "maxMarks": 100,
                      "obtained": null,
                      "grade": "AB",
                      "gradeLabel": "",
                      "absent": true,
                      "remark": "",
                      "parts": [],
                      "gradedParts": [],
                    },
                  ],
                  "totals": {"obtained": 72.5, "max": 100},
                  "percent": 72.5,
                  "overallGrade": "B1",
                  "rank": 3,
                  "classSize": 30,
                  "classAverage": null,
                  "result": null,
                  "attendance": {
                    "presentDays": 90,
                    "workingDays": 100,
                    "percent": 90,
                  },
                  "coScholastic": [
                    {
                      "label": "Art",
                      "rating": "A",
                      "ratingLabel": "Outstanding",
                    },
                  ],
                  "remark": {"text": "Good progress", "textHi": "अच्छी प्रगति"},
                  "absent": null,
                  "absentSubjects": ["Mathematics"],
                },
              },
            ],
          },
        ],
      });

      expect(r.releasedTermCount, 2);
      final terms = r.termsFor("stu_1");
      expect(terms.length, 2);
      expect(terms.first.isReady, isFalse);
      expect(terms.first.status, "no_marks");
      expect(terms.first.card, isNull);

      final card = terms.last.card!;
      expect(terms.last.isReady, isTrue);
      expect(card.aggregateMode, "hy");
      expect(card.subjects.first.marksText, "72.5/100");
      expect(card.subjects.first.parts.last.obtained, isNull);
      expect(card.subjects.first.gradedParts.last.grade, isNull);
      expect(card.subjects.last.marksText, "AB");
      expect(card.hasTotals, isTrue);
      expect(resultNumber(card.totalObtained), "72.5");
      expect(resultNumber(card.totalMax), "100");
      expect(card.rank, 3);
      expect(card.classAverage, isNull);
      expect(card.result, isNull);
      expect(card.hasAttendance, isTrue);
      expect(card.absent, isFalse);
      expect(card.absentSubjects, ["Mathematics"]);
      expect(card.remarkFor("hi"), "अच्छी प्रगति");
      expect(card.remarkFor("en"), "Good progress");
    });

    test("what the card does not print is absent, never zero", () {
      final card = ParentReportCard.fromJson(const {
        "title": "Progress card",
        "termLabel": "Unit Test 1",
        "aggregateMode": "none",
        "gradesOnly": true,
        "descriptors": true,
        "subjects": [
          {
            "subjectId": "s",
            "name": "EVS",
            "maxMarks": null,
            "obtained": null,
            "grade": "B",
            "gradeLabel": "Meets expectations",
            "absent": false,
            "remark": "",
            "parts": [],
            "gradedParts": [],
          },
        ],
        "totals": null,
        "percent": null,
        "overallGrade": null,
        "rank": null,
        "classSize": null,
        "classAverage": null,
        "result": null,
        "attendance": null,
        "coScholastic": [],
        "remark": null,
        "absent": {"reason": "Medical"},
        "absentSubjects": [],
      });
      expect(card.hasTotals, isFalse);
      expect(card.percent, isNull);
      expect(card.overallGrade, isNull);
      expect(card.rank, isNull);
      expect(card.hasAttendance, isFalse);
      expect(card.hasRemark, isFalse);
      expect(card.absent, isTrue);
      expect(card.absentReason, "Medical");
      expect(card.subjects.single.gradeLabel, "Meets expectations");
    });

    test("another child's id finds nothing, not someone else's results", () {
      final r = ParentResults.fromJson(const {
        "releasedTermCount": 0,
        "children": [
          {
            "studentId": "stu_1",
            "fullName": "A",
            "classLabel": "I",
            "terms": [],
          },
        ],
      });
      expect(r.termsFor("stu_1"), isEmpty);
      expect(r.termsFor("stu_other"), isEmpty);
    });
  });

  group("parent date sheet", () {
    test("papers per child, keyed by the child", () {
      final d = ParentDateSheet.fromJson(const {
        "publishedTermCount": 1,
        "today": "2026-10-13",
        "children": [
          {
            "studentId": "stu_1",
            "fullName": "A",
            "classLabel": "V-A",
            "exams": [
              {
                "termId": "term_hy",
                "termLabel": "Half-yearly",
                "publishedAt": "2026-10-10T00:00:00Z",
                "rows": [
                  {
                    "date": "2026-10-20",
                    "startTime": "09:00",
                    "durationMinutes": 150,
                    "subjectName": "English",
                    "note": "Bring a pencil",
                  },
                ],
              },
            ],
          },
          {
            "studentId": "stu_2",
            "fullName": "B",
            "classLabel": "II-A",
            "exams": [],
          },
        ],
      });
      expect(d.publishedTermCount, 1);
      final exams = d.examsFor("stu_1");
      expect(exams.single.termLabel, "Half-yearly");
      expect(exams.single.papers.single.durationMinutes, 150);
      expect(exams.single.papers.single.note, "Bring a pencil");
      expect(d.examsFor("stu_2"), isEmpty);
      expect(d.examsFor("nobody"), isEmpty);
    });

    test("result numbers drop a trailing .0", () {
      expect(resultNumber(72), "72");
      expect(resultNumber(72.0), "72");
      expect(resultNumber(72.25), "72.3");
      expect(resultNumber(null), "—");
    });
  });
}
