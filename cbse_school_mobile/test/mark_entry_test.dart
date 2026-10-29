import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/features/staff/marks_screen.dart";
import "package:flutter_test/flutter_test.dart";

// A subject marked in parts (English = Written 80 + Oral 20), one student
// with Written pre-filled to 70 and Oral to 15.
Map<String, dynamic> splitSheet() => {
  "term": {"label": "Half-yearly", "maxMarks": 100},
  "locked": false,
  "updatedAt": "",
  "enteredBy": "",
  "passPercent": 33,
  "subjects": [
    {
      "id": "sub_eng",
      "code": "ENG",
      "name": "English",
      "maxMarks": 100,
      "marksParts": [
        {"code": "WRIT", "label": "Written", "maxMarks": 80, "kind": "exam"},
        {"code": "ORAL", "label": "Oral", "maxMarks": 20, "kind": "internal"},
      ],
      "gradedParts": [],
    },
  ],
  "students": [
    {
      "id": "stu_1",
      "fullName": "Asha",
      "rollNo": "1",
      "marks": [
        {
          "subjectId": "sub_eng",
          "marksObtained": null,
          "grade": "",
          "parts": [
            {"component": "WRIT", "marksObtained": 70},
            {"component": "ORAL", "marksObtained": 15},
          ],
          "gradedParts": [],
        },
      ],
    },
  ],
};

// An ordinary subject: one whole mark out of 100, pre-filled to 55.
Map<String, dynamic> wholeSheet() => {
  "term": {"label": "Half-yearly", "maxMarks": 100},
  "locked": false,
  "updatedAt": "",
  "enteredBy": "",
  "passPercent": 33,
  "subjects": [
    {"id": "sub_mat", "code": "MAT", "name": "Maths", "maxMarks": 100},
  ],
  "students": [
    {
      "id": "stu_1",
      "fullName": "Asha",
      "rollNo": "1",
      "marks": [
        {"subjectId": "sub_mat", "marksObtained": 55, "grade": "D"},
      ],
    },
  ],
};

// A class graded on two co-scholastic areas (Work Education, Music) on a
// three-band A/B/C scale. One student has WE = A already, Music unrated.
Map<String, dynamic> coschSheet() => {
  "term": {"label": "Half-yearly", "maxMarks": 100},
  "locked": false,
  "updatedAt": "",
  "enteredBy": "",
  "passPercent": 33,
  "subjects": [
    {"id": "sub_mat", "code": "MAT", "name": "Maths", "maxMarks": 100},
  ],
  "coScholastic": {
    "scale": "three",
    "grades": ["A", "B", "C"],
    "areas": [
      {"code": "WE", "label": "Work Education"},
      {"code": "MUS", "label": "Music"},
    ],
  },
  "students": [
    {
      "id": "stu_1",
      "fullName": "Asha",
      "rollNo": "1",
      "coScholastic": [
        {"domain": "WE", "rating": "A"},
        {"domain": "MUS", "rating": ""},
      ],
      "marks": [
        {"subjectId": "sub_mat", "marksObtained": 55, "grade": "D"},
      ],
    },
  ],
};

void main() {
  group("co-scholastic grading", () {
    test("the sheet carries the areas and the allowed grades from the server", () {
      final s = MarkSheetInfo.fromJson(coschSheet());
      expect(s.coScholasticAreas.map((a) => a.code).toList(), ["WE", "MUS"]);
      expect(s.coScholasticAreas.map((a) => a.label).toList(), ["Work Education", "Music"]);
      // The grade options are the server's, never a hard-coded list.
      expect(s.coScholasticGrades, ["A", "B", "C"]);
    });

    test("existing grades pre-fill; unrated and unknown areas read back empty", () {
      final st = MarkSheetInfo.fromJson(coschSheet()).students.first;
      expect(st.coScholasticGrade("WE"), "A");
      expect(st.coScholasticGrade("MUS"), "");
      expect(st.coScholasticGrade("GK"), "");
    });

    test("a class without co-scholastic shows none", () {
      // wholeSheet() carries no coScholastic block at all.
      final s = MarkSheetInfo.fromJson(wholeSheet());
      expect(s.coScholasticAreas, isEmpty);
      expect(s.coScholasticGrades, isEmpty);
    });

    test("saving posts one grade per student for the area, '' to clear", () {
      final entries = coScholasticEntriesFor(
        "WE",
        ["stu_1", "stu_2"],
        (id) => {"stu_1": "B", "stu_2": ""}[id],
      );
      expect(entries.length, 2);
      expect(entries[0], (studentId: "stu_1", domain: "WE", rating: "B"));
      // A blank selection clears that pair back to unrated, never a guess.
      expect(entries[1], (studentId: "stu_2", domain: "WE", rating: ""));
    });
  });

  group("mark-entry columns (one field per column)", () {
    test("a split subject gives one column per part, each with its own max", () {
      final sub = MarkSheetInfo.fromJson(splitSheet()).subjects.first;
      expect(sub.isSplit, isTrue);
      final cols = markEntryColumns(sub);
      // Three fields would render for a three-part subject; here two.
      expect(cols.map((c) => c.component).toList(), ["WRIT", "ORAL"]);
      expect(cols.map((c) => c.max).toList(), [80, 20]);
      expect(cols.map((c) => c.label).toList(), ["Written", "Oral"]);
    });

    test("an ordinary subject keeps its single whole-mark column", () {
      final sub = MarkSheetInfo.fromJson(wholeSheet()).subjects.first;
      expect(sub.isSplit, isFalse);
      final cols = markEntryColumns(sub);
      expect(cols.length, 1);
      expect(cols.single.component, "");
      expect(cols.single.max, 100);
    });
  });

  group("pre-fill", () {
    test("each already-entered part mark is read back for its field", () {
      final st = MarkSheetInfo.fromJson(splitSheet()).students.first;
      expect(st.markFor("sub_eng")!.partMark("WRIT"), 70);
      expect(st.markFor("sub_eng")!.partMark("ORAL"), 15);
      expect(st.markFor("sub_eng")!.partMark("MISSING"), isNull);
    });

    test("a whole subject reads its single mark", () {
      final st = MarkSheetInfo.fromJson(wholeSheet()).students.first;
      expect(st.markFor("sub_mat")!.marksObtained, 55);
    });
  });

  group("per-component validation", () {
    test("rejects a mark over THAT component's own max, not a flat 100", () {
      expect(markEntryValid("80", 80), isTrue);
      expect(markEntryValid("81", 80), isFalse);
      // 25 would pass for Written (max 80) but is over Oral's own 20.
      expect(markEntryValid("25", 20), isFalse);
      expect(markEntryValid("20", 20), isTrue);
    });

    test("blank is allowed (absent); negatives and junk are not", () {
      expect(markEntryValid("", 80), isTrue);
      expect(markEntryValid("  ", 80), isTrue);
      expect(markEntryValid("-1", 80), isFalse);
      expect(markEntryValid("x", 80), isFalse);
    });
  });

  group("save payload (what saveMarks POSTs)", () {
    test("a split subject posts one entry per component", () {
      final sub = MarkSheetInfo.fromJson(splitSheet()).subjects.first;
      final typed = {"stu_1\u0000WRIT": "76", "stu_1\u0000ORAL": "18"};
      final entries = markEntriesFor(
        markEntryColumns(sub),
        ["stu_1"],
        (id, comp) => typed["$id\u0000$comp"],
      );
      expect(entries.length, 2);
      expect(entries[0], (studentId: "stu_1", component: "WRIT", marks: 76.0));
      expect(entries[1], (studentId: "stu_1", component: "ORAL", marks: 18.0));
    });

    test("a blank part posts null (absent), never 0", () {
      final sub = MarkSheetInfo.fromJson(splitSheet()).subjects.first;
      final typed = {"stu_1\u0000WRIT": "70", "stu_1\u0000ORAL": ""};
      final entries = markEntriesFor(
        markEntryColumns(sub),
        ["stu_1"],
        (id, comp) => typed["$id\u0000$comp"],
      );
      expect(entries.firstWhere((e) => e.component == "ORAL").marks, isNull);
    });

    test("a non-split subject posts a single empty-component entry", () {
      final sub = MarkSheetInfo.fromJson(wholeSheet()).subjects.first;
      final entries = markEntriesFor(
        markEntryColumns(sub),
        ["stu_1"],
        (id, comp) => "55",
      );
      expect(entries, [(studentId: "stu_1", component: "", marks: 55.0)]);
    });
  });
}
