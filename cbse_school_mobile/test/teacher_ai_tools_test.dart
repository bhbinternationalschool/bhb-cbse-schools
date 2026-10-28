import 'package:cbse_school_mobile/core/api/api_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reads the answer-sheet reply (api/ai/answer-sheet-marks) — unknown stays null, never 0', () {
    final r = AnswerSheetReading.fromJson({
      'generationId': 'aig_abc12345',
      'paperId': 'p1',
      'setCode': 'A',
      'maxTotal': 10,
      'totalSuggested': 5.5,
      'unknownCount': 1,
      'questions': [
        {
          'questionId': 'q1',
          'number': 1,
          'maxMarks': 4,
          'readAnswer': 'photosynthesis',
          'suggestedMarks': 3.5,
          'confidence': 'high',
          'reason': 'Key point present',
          'needsTeacher': false,
          'text': 'Define photosynthesis',
          'type': 'short',
          'hasKey': true,
        },
        {
          'questionId': 'q2',
          'number': 2,
          'maxMarks': 6,
          'readAnswer': '',
          'suggestedMarks': null,
          'confidence': 'low',
          'reason': 'Page missing',
          'needsTeacher': true,
          'text': 'Explain',
          'type': 'long',
          'hasKey': false,
        },
        {
          'questionId': 'q3',
          'number': 3,
          'maxMarks': 2,
          'suggestedMarks': 2,
          'confidence': 'medium',
          'needsTeacher': true,
        },
      ],
    });
    expect(r.generationId, 'aig_abc12345');
    expect(r.questions, hasLength(3));
    expect(r.questions[0].shown, 3.5);
    expect(r.questions[1].suggestedMarks, isNull);
    expect(r.questions[1].shown, isNull);
    // needsTeacher wins over a number: the box starts blank.
    expect(r.questions[2].shown, isNull);

    // Untouched boxes → accepted; any change (or filling a blank) → edited.
    expect(answerSheetOutcome(r.questions, {'q1': 3.5, 'q2': null, 'q3': null}), 'accepted');
    expect(answerSheetOutcome(r.questions, {'q1': 3.5, 'q2': 4, 'q3': null}), 'edited');

    final open = answerSheetTotals(r.questions, {'q1': 3.5, 'q2': null, 'q3': null});
    expect(open.blanks, 2);
    expect(open.total, 3.5);
    final bad = answerSheetTotals(r.questions, {'q1': 3.5, 'q2': 7, 'q3': 1});
    expect(bad.over, 1, reason: '7 is above Q2\'s 6');
    final done = answerSheetTotals(r.questions, {'q1': 3.5, 'q2': 4, 'q3': 1.5});
    expect((done.total, done.blanks, done.over), (9.0, 0, 0));
  });

  test('reads the papers list for a scan', () {
    final p = AnswerSheetPaper.fromJson({
      'id': 'p1',
      'paperCode': 'HY-SCI-6',
      'title': 'Half yearly',
      'examName': 'HY',
      'termMatch': true,
      'activeSetCode': 'B',
      'sets': [
        {'setCode': 'A', 'label': 'Set A', 'questionCount': 20, 'keyedCount': 18, 'maxTotal': 80},
        {'setCode': 'B', 'label': 'Set B', 'questionCount': 20, 'keyedCount': 20, 'maxTotal': 80},
      ],
    });
    expect(p.label, 'HY-SCI-6 · Half yearly');
    expect(p.sets.last.keyedCount, 20);
    expect(p.sets.first.maxTotal, 80);
  });

  test('reads a question paper draft and renders student / teacher copies', () {
    final d = AiPaperDraft.fromJson({
      'source': 'llm',
      'engine': 'gemini',
      'generationId': 'aig_paper0001',
      'explanation': ['Balanced across chapters.'],
      'maxMarks': 20,
      'sections': [
        {
          'title': 'Section A',
          'instructions': 'Answer all.',
          'questions': [
            {
              'type': 'mcq',
              'text': 'Which gas do plants take in?',
              'marks': 1,
              'options': ['Oxygen', 'Carbon dioxide'],
              'answerKey': 'Carbon dioxide',
              'markingScheme': [],
              'pairs': [],
              'attemptAny': 0,
              'hasImages': false,
              'subQuestions': [],
            },
            {
              'type': 'long',
              'text': 'Explain the water cycle.',
              'marks': 4.5,
              'answerKey': 'Evaporation, condensation…',
              'markingScheme': ['Evaporation 1', 'Condensation 1'],
              'hasImages': true,
              'subQuestions': [
                {'text': 'Name one stage', 'marks': 1, 'answerKey': 'Evaporation'},
              ],
            },
          ],
        },
      ],
    });
    expect(d.isOffline, isFalse);
    expect(d.totalMarks, 5.5);
    final student = aiPaperText(heading: 'VI · Science', sections: d.sections);
    expect(student, contains('Q1. Which gas do plants take in?  [1]'));
    expect(student, contains('(b) Carbon dioxide'));
    expect(student, contains('Q2. Explain the water cycle.  [4.5]'));
    expect(student, contains('(i) Name one stage  [1]'));
    expect(student, contains('[picture — see the ERP]'));
    expect(student, isNot(contains('Answer:')), reason: 'the student copy never carries the key');
    final teacher = aiPaperText(heading: '', sections: d.sections, withAnswers: true);
    expect(teacher, contains('Answer: Carbon dioxide'));
    expect(teacher, contains('• Evaporation 1'));
    expect(teacher, contains('Answer: Evaporation'));

    final offline = AiPaperDraft.fromJson({'source': 'local', 'generationId': '', 'sections': []});
    expect(offline.isOffline, isTrue);
    expect(offline.generationId, '');
  });

  test('reads targets, chapters, lesson plan and PTM brief', () {
    final t = AiTargetClass.fromJson({
      'id': 'c6',
      'name': 'VI',
      'subjects': [
        {'id': 's1', 'name': 'Science', 'code': 'SCI'},
      ],
    });
    expect(t.subjects.single.code, 'SCI');

    final u = AiUnits.fromJson({
      'available': true,
      'chapters': [
        {
          'id': 'u1',
          'code': 'Ch 1',
          'title': 'Food',
          'plannedPeriods': 3,
          'hasOutcomes': true,
          'topics': [
            {'id': 't1', 'code': '', 'title': 'Sources'},
          ],
        },
      ],
    });
    expect(u.chapters.single.label, 'Ch 1 · Food');
    expect(u.chapters.single.topics.single.label, 'Sources');
    expect(AiUnits.fromJson({}).available, isFalse, reason: 'unreadable plan ≠ empty plan');

    final lp = AiLessonPlanDraft.fromJson({
      'language': 'hi',
      'engine': 'gemini',
      'model': 'gemini-x',
      'generationId': 'aig_lp000001',
      'booksKind': 'chapters',
      'agreedOutcomeUnits': 1,
      'unitIds': ['u1'],
      'draft': {
        'title': 'Food sources',
        'objectives': 'Name sources',
        'teachingAids': '',
        'activities': 'Sort cards',
        'assessment': 'Quiz',
        'homework': 'List 5 foods',
      },
    });
    expect(lp.title, 'Food sources');
    expect(lp.unitIds, ['u1']);
    expect(lp.agreedOutcomeUnits, 1);

    final b = AiPtmBrief.fromJson({
      'studentId': 'st1',
      'studentName': 'Asha Verma',
      'generationId': 'aig_ptm00001',
      'language': 'hi',
      'draft': {'observations': 'O', 'concerns': '', 'suggestions': 'S'},
      'warnings': [],
      'basis': {
        'terms': ['Half yearly'],
        'attendance': false,
        'homework': true,
        'conduct': false,
        'earlierNotes': 0,
      },
    });
    expect(b.observations, 'O');
    expect(b.missing, ['attendance', 'conduct log']);
  });
}
