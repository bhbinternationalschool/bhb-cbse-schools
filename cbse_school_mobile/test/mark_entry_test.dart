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

void main() {
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
