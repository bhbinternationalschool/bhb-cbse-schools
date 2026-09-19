# Row lists → tables

The director's instruction, 19 Sep 2026: *wherever row-level lists are
present, convert them into table format like the date sheet.*

This is the register of that work, so the next pass starts from evidence
rather than re-deriving it.

## What the sweep found

A scan of every office component (`apps/web/src/components`, excluding the
parent app, PWA, public site, login and the shared `ui/` kit) found **368
places where `<li>` rows are rendered from a `.map`**, in 172 components.

They are not all the same thing, and most of the difference matters:

| Kind | Count | What happens to it |
|---|---:|---|
| Record rows — a thing per row with several fields | **270** | becomes a `DataTable` |
| Prose, diagnostics, menus, chart furniture | 98 | **stays a list** |

## What stays a list, and why

A table is for rows that are compared, sorted, filtered and exported. These
are not, and a table makes each of them worse:

- **Warnings, errors, blockers, validation problems** — read as sentences,
  not compared column by column.
- **Report launchers** (`ACCOUNTS_REPORTS`, `TRUST_REPORT_CATEGORIES`, …) —
  a menu of things to run.
- **Search results in a picker** — a dropdown that disappears on click.
- **Narrative timelines** — a child's health history, a lead's timeline: read
  in order, as a story.
- **Chat threads and message inboxes** — a conversation is not a grid.
- **Printed question papers** — options and sub-questions are the document.
- **Short notes** — today's gate duty is two fields and four rows.

## The standard a converted screen carries

`DataTable` (`components/ui/data-table.tsx`) over the premium grid kit:
sortable columns, client pagination, a row-action menu replacing the loose
buttons a card used to carry, a checkbox column with a bulk bar where it
earns its place, and Excel / CSV / PDF export of exactly what is filtered on
screen. Where a panel already has a tailored `ExportMenu`, that one stays —
two export buttons on one panel is worse than either.

## Done

| Screen | Lists converted | Left as lists, and why |
|---|---|---|
| `health/HealthWorkspace.tsx` | visits, medications, vaccinations | student picker; the per-child timeline (a story, read in order) |
| `visitors/VisitorsWorkspace.tsx` | gate register, gate passes | student picker; today's gate duty (two fields, four rows) |
| `comms/CommsWorkspace.tsx` | notices, scheduled queue, social cross-post log | news stories — each leads with a cover photograph |
| `library/LibraryWorkspace.tsx` | overdue loans, the e-book shelf | open loans (each row opens a return form inside itself); procurement docs (each is a photo of a bill) |

### Judged and skipped, so nobody re-opens them

| Screen | Why it stays as it is |
|---|---|
| `homework/HomeworkWorkspace.tsx` | All three lists are content, not records. A submission is a photograph of a child's work with the teacher's remark under it; a diary entry and a homework post are paragraphs the parent reads. A table would hide the very thing the teacher acts on. |
| `staff/StaffDutiesPanel.tsx` | Four link lists inside a staff member's edit drawer, three rows each. DataTable's pagination and export weigh more than the list does. |

## The queue

Ordered by weight — the number of fields a row carries, plus a bonus where
rows already have edit/delete actions, since those are the screens where a
row menu removes the most clutter.

| # | component | lists | weight | row actions | the lists |
|---|---|---|---|---|---|
| 1 | `transport/TransportFleetPanels.tsx` | 8 | 68 | no | alerts, dueEmis, liveBuses, onRoad, open, riders, state.deal |
| 2 | `homework/HomeworkWorkspace.tsx` | 4 | 58 | yes | pendingSubs, todayDiary, todayPosts |
| 3 | `staff/StaffDutiesPanel.tsx` | 4 | 52 | yes | draft.classTeacherLinks, draft.dutyLinks, draft.subjectTeach |
| 4 | `comms/CommsWorkspace.tsx` | 4 | 51 | yes | newsFiltered, noticesFiltered, scheduledItems, socialLogs |
| 5 | `masters/ConcessionsPanel.tsx` | 5 | 47 | yes | concessions, grants, kinds, matches, siblingTiers |
| 6 | `fees/FeeTakeWorkspace.tsx` | 5 | 44 | yes | hits, tenderLines, unsettledStore, v.tenders |
| 7 | `masters/MastersWorkspace.tsx` | 3 | 44 | yes | rows, sectionsForClass, state.campuses |
| 8 | `masters/FoundationPanels.tsx` | 6 | 42 | yes | activeDepts, activeDes, items, rows, state.academicYears, su |
| 9 | `masters/ConcessionPolicyDraftCard.tsx` | 3 | 37 | no | clusters, rules, visible |
| 10 | `masters/SpecialFeesPanel.tsx` | 3 | 37 | yes | assignmentsForSelected, specialFees, studentsForPicker |
| 11 | `transport/TransportOpsPanels.tsx` | 6 | 37 | no | fuels, jobs, state.fuelStockLocations, state.routes, state.v |
| 12 | `accounts/LedgerPanels.tsx` | 3 | 33 | no | rows |
| 13 | `rte/RteWorkspace.tsx` | 2 | 33 | yes | enrolled, seatRows |
| 14 | `admissions/ReferralsPanel.tsx` | 1 | 32 | yes | state.testimonials |
| 15 | `masters/automation/AutomationListView.tsx` | 2 | 31 | yes | filteredRules, pending |
| 16 | `accounts/AccountsPanels.tsx` | 5 | 29 | no | bills, journals, pl.expenseLines, pl.incomeLines, state.recu |
| 17 | `discipline/DisciplineWorkspace.tsx` | 3 | 29 | yes | allRows, byStudentMatches, studentMatches |
| 18 | `fees/DayClosePanel.tsx` | 4 | 29 | no | book.kindTotals, book.vouchers, history, rows |
| 19 | `masters/FeeStructureBoard.tsx` | 3 | 29 | yes | bandSections, lines, section.groups |
| 20 | `fees/ManualBookPanel.tsx` | 3 | 28 | yes | hits, postings, tenderLines |
| 21 | `library/LibraryWorkspace.tsx` | 3 | 28 | yes | overdue, state.ebooks, state.procurementDocs |
| 22 | `payroll/ApprovalsInboxPanel.tsx` | 2 | 28 | no | incrementPending, payrollPending |
| 23 | `admissions/SequencesPanel.tsx` | 1 | 27 | yes | saved |
| 24 | `attendance/AttendanceWorkspace.tsx` | 2 | 27 | yes | recent, roster |
| 25 | `masters/SalarySetupPanel.tsx` | 3 | 27 | no | editing.lines, heads, state.structures |
| 26 | `admissions/VillageDemographicsGrid.tsx` | 3 | 26 | no | data.leadCoverage.topUnmatched, filtered, ranked |
| 27 | `staff/StaffLeavePanel.tsx` | 2 | 26 | no | adjustable, rows |
| 28 | `transport/FleetEdgeReport.tsx` | 4 | 26 | no | v.faultCriticalDetails, v.lowEngineOilPressureEvents |
| 29 | `transport/TransportWorkspace.tsx` | 3 | 26 | no | householdSiblings, routes, shown |
| 30 | `fees/DefaultersPlaybook.tsx` | 3 | 25 | no | filtered, playbook.doNow, policyHolds |
| 31 | `students/StudentCurriculumEditor.tsx` | 3 | 25 | yes | inBucket, list |
| 32 | `masters/TutorPassesPanel.tsx` | 2 | 24 | no | plans, rules |
| 33 | `payroll/StatutoryRemitPanel.tsx` | 2 | 24 | no | done, pending |
| 34 | `staff/DutyRosterPanel.tsx` | 2 | 23 | yes | cellAssignments, state.templates |
| 35 | `staff/TeachingAllocationPanel.tsx` | 2 | 23 | yes | myClassLinks, mySubjectLinks |
| 36 | `admissions/AdmissionCampaignsPanel.tsx` | 2 | 22 | no | wa.campaigns, wa.lists |
| 37 | `fees/DueBreakupPicker.tsx` | 4 | 22 | no | d.concessionDetails, d.storeItems |
| 38 | `masters/FeeSetupPanels.tsx` | 3 | 22 | no | bandSections, list, rows |
| 39 | `masters/wa-templates/WaTemplatesListView.tsx` | 1 | 22 | yes | filtered |
| 40 | `online-classes/OnlineClassesWorkspace.tsx` | 2 | 22 | no | data.rows |
| 41 | `masters/SchoolTimingPanel.tsx` | 2 | 20 | yes | config.classOverrides, config.groupOverrides |
| 42 | `comms/WaChatHubPanel.tsx` | 2 | 19 | no | item.ocrResult.fields, mediaItems |
| 43 | `fees/FeeAdjustmentsPanel.tsx` | 3 | 19 | no | dues, pending, students |
| 44 | `fees/FutureConcessionModal.tsx` | 2 | 19 | no | c.existing, candidates |
| 45 | `masters/automation/AutomationSentMessages.tsx` | 1 | 19 | no | rows |
| 46 | `fees/PayLinksPanel.tsx` | 1 | 18 | no | visible |
| 47 | `transport/NearestStopPicker.tsx` | 2 | 18 | no | predictions, ranked |
| 48 | `transport/ShiftCoveragePanel.tsx` | 2 | 18 | no | ], rows |
| 49 | `comms/WaNumberGapBanner.tsx` | 1 | 17 | no | rows |
| 50 | `fees/FeeReceiptSheet.tsx` | 2 | 16 | no | line.storeItems |
| 51 | `fees/StorePurchasesPanel.tsx` | 1 | 16 | no | sales |
| 52 | `health/HealthWorkspace.tsx` | 2 | 16 | no | matches, timeline |
| 53 | `masters/MobileAccessPanel.tsx` | 1 | 16 | yes | personalGrants |
| 54 | `timetable/TimetableWorkspace.tsx` | 3 | 16 | no | bellDraft, lastResult.unfilled, sessionPublishedGrids |
| 55 | `accounts/AccountsMastersPanel.tsx` | 1 | 15 | yes | state.vendors |
| 56 | `exams/ReportCardTemplatesPanel.tsx` | 1 | 15 | yes | policy.reportTemplates |
| 57 | `fees/ChargeVouchersPanel.tsx` | 2 | 15 | no | draftLines, hits |
| 58 | `fees/ChequesPanel.tsx` | 1 | 15 | no | cheques |
| 59 | `transport/BoardingSuggestionCard.tsx` | 1 | 15 | no | candidates |
| 60 | `comms/HouseholdMessageLogPanel.tsx` | 1 | 14 | no | entries |
| 61 | `exams/ExamsWorkspace.tsx` | 3 | 14 | no | allTerms, conflicts, roster |
| 62 | `masters/StaffAttendanceRulesPanel.tsx` | 1 | 14 | yes | state.rules |
| 63 | `masters/automation/AutomationBadNumbers.tsx` | 1 | 14 | no | rows |
| 64 | `payroll/JuneHoldPanel.tsx` | 1 | 14 | no | settlements |
| 65 | `teaching/ResourceLinks.tsx` | 1 | 14 | yes | resources |
| 66 | `transport/StaffRiderPanel.tsx` | 1 | 14 | no | riders |
| 67 | `admissions/LeadMobileWaCheckPanel.tsx` | 3 | 13 | no | leads, list, openLeads |
| 68 | `admissions/MarketingPanel.tsx` | 1 | 13 | yes | spend.entries |
| 69 | `attendance/AttendanceExceptionsPanel.tsx` | 2 | 13 | no | openRows, recentNudges |
| 70 | `comms/AnswerBookPanel.tsx` | 1 | 13 | no | group.rows |
| 71 | `fees/SisParentWaInbox.tsx` | 1 | 13 | no | visible |
| 72 | `masters/ConcessionCaseFileInline.tsx` | 2 | 13 | no | facts.grants, facts.siblings |
| 73 | `masters/StaffLeaveTypesPanel.tsx` | 1 | 13 | yes | hr.leaveTypes |
| 74 | `transport/TransportPlannerPanel.tsx` | 2 | 13 | no | c.unassignedNearby, unassigned |
| 75 | `comms/EmailIntegrationPanel.tsx` | 1 | 12 | no | log |
| 76 | `exams/InvigilationPanel.tsx` | 1 | 12 | yes | assignments |
| 77 | `field/StaffLeadCallingApp.tsx` | 1 | 12 | no | myLeads |
| 78 | `inventory/MastersTab.tsx` | 1 | 12 | yes | rows |
| 79 | `staff/StaffGeoAdminPanel.tsx` | 1 | 12 | no | incidents |
| 80 | `visitors/VisitorSelfServiceApp.tsx` | 2 | 12 | no | lookup.leads, lookup.parentOf |
| 81 | `accounts/LedgerEntryPanels.tsx` | 2 | 11 | no | c.children, g.rows |
| 82 | `admissions/AdmissionsWorkspace.tsx` | 2 | 11 | no | hh.guardians, siblings |
| 83 | `certificates/CertificateSheet.tsx` | 2 | 11 | no | breakups, rows |
| 84 | `fees/StoreSellInline.tsx` | 2 | 11 | no | cart, matches |
| 85 | `staff/StaffMessageTimelinePanel.tsx` | 1 | 11 | no | filtered |
| 86 | `students/StudentDuplicatesPanel.tsx` | 1 | 11 | no | g.students |
| 87 | `students/StudentFeeDuesCard.tsx` | 1 | 11 | no | summary.siblings |
| 88 | `timetable/SubstitutionPanel.tsx` | 1 | 11 | yes | allAbsent |
| 89 | `admissions/LeadTimeline.tsx` | 1 | 10 | no | visible |
| 90 | `admissions/ReferralPolicyEditor.tsx` | 1 | 10 | no | pending |
| 91 | `exams/ExamPapersPanel.tsx` | 1 | 10 | no | papers |
| 92 | `exams/ExamSeatingPanel.tsx` | 1 | 10 | yes | rooms |
| 93 | `idCards/IdCardsWorkspace.tsx` | 2 | 10 | no | staff, students |
| 94 | `students/StudentExamMarksCard.tsx` | 1 | 10 | no | load.cards |
| 95 | `students/UdiseComplianceWorkspace.tsx` | 1 | 10 | no | callList |
| 96 | `teaching/SyllabusOcrImport.tsx` | 1 | 10 | no | rows |
| 97 | `transport/FleetRosterPanel.tsx` | 1 | 10 | no | roster.staffRiders |
| 98 | `transport/PinsReceivedPanel.tsx` | 1 | 10 | no | r.children |
| 99 | `exams/AdmitCardsPanel.tsx` | 2 | 9 | no | allowedRows, blockedRows |
| 100 | `fees/ManualPreviousDuePanel.tsx` | 2 | 9 | no | existing, hits |
| 101 | `masters/SectionTeachersPanel.tsx` | 1 | 9 | no | offerings |
| 102 | `payroll/PrintPayslipsPanel.tsx` | 3 | 9 | no | deductions, earnings, employer |
| 103 | `staff/StaffOutdoorDutyPanel.tsx` | 1 | 9 | no | active |
| 104 | `students/DocVerificationQueuePanel.tsx` | 1 | 9 | no | items |
| 105 | `teaching/LessonPlansPanel.tsx` | 1 | 9 | no | plans |
| 106 | `fees/InstallmentPlanDialog.tsx` | 2 | 8 | no | plan.slices, preview |
| 107 | `masters/wa-chatbot/WaChatbotBuilder.tsx` | 1 | 8 | no | nodes |
| 108 | `students/StudentImportPanel.tsx` | 1 | 8 | no | preview.sample |
| 109 | `students/StudentsWorkspace.tsx` | 1 | 8 | no | filtered |
| 110 | `transport/FleetEdgeStatusStrip.tsx` | 1 | 8 | no | link.matched |
| 111 | `accounts/VendorHistoryPanel.tsx` | 1 | 7 | no | shown |
| 112 | `admissions/LeadWorklistPanel.tsx` | 1 | 7 | no | b.leads |
| 113 | `admissions/SisParentMatchBanner.tsx` | 1 | 7 | no | match.students |
| 114 | `exams/AssessmentSchemesPanel.tsx` | 1 | 7 | no | policy.schemes |
| 115 | `field/SurveyAgentApp.tsx` | 1 | 7 | no | state.surveyBeats |
| 116 | `modules/ModulesWorkspace.tsx` | 1 | 7 | no | g.modules |
| 117 | `payroll/IncrementPanel.tsx` | 1 | 7 | no | batches |
| 118 | `visitors/VisitorsWorkspace.tsx` | 2 | 7 | no | matches, todayDutyAssignments |
| 119 | `comms/WaStudentPicker.tsx` | 1 | 6 | no | shown |
| 120 | `fees/BulkPreviousDueByClassPanel.tsx` | 1 | 6 | no | roster |
| 121 | `students/LegacyAdmissionVerifyPanel.tsx` | 1 | 6 | no | pending |
| 122 | `students/StudentSiblingsPanel.tsx` | 1 | 6 | no | students |
| 123 | `transport/BoardingPointAuditPanel.tsx` | 1 | 6 | no | data.clusters |
| 124 | `transport/FleetEdgeEventsPanel.tsx` | 1 | 6 | no | events |
| 125 | `website/MediaLibrary.tsx` | 1 | 6 | no | items |
| 126 | `admissions/AdmissionFieldSurveyPanel.tsx` | 1 | 5 | no | offlineQueue |
| 127 | `admissions/AdmissionRegistrationPanel.tsx` | 1 | 5 | no | g.leads |
| 128 | `comms/SocialCredentialsPanel.tsx` | 1 | 5 | no | pub.pendingPages |
| 129 | `exams/ReportCardSheet.tsx` | 1 | 5 | no | card.lines |
| 130 | `fees/CollectionsWeeklyNoteCard.tsx` | 1 | 5 | no | facts.ageing |
| 131 | `inventory/CounterTab.tsx` | 1 | 5 | no | repeats |
| 132 | `masters/wa-templates/WaTemplatesEditView.tsx` | 1 | 5 | no | carousel |
| 133 | `exams/ItemAnalysis.tsx` | 1 | 4 | no | below |
| 134 | `fees/FeeFinancePanels.tsx` | 1 | 4 | no | studentHits |
| 135 | `staff/StaffAgreementPanel.tsx` | 1 | 4 | no | row.audit |
| 136 | `students/StudentProfileModal.tsx` | 1 | 4 | no | sibs |
| 137 | `students/StudentPromotionPanel.tsx` | 1 | 4 | no | eligible |
| 138 | `students/StudentUpdatePanel.tsx` | 1 | 4 | no | hits |
| 139 | `students/StudentUpgradePanel.tsx` | 1 | 4 | no | hits |
| 140 | `teaching/SyllabusPlanPanel.tsx` | 1 | 4 | no | subjectCoverage |
| 141 | `transport/PinRequestPanel.tsx` | 1 | 4 | no | preview.targets |
| 142 | `transport/StopDistanceBackfillCard.tsx` | 1 | 4 | no | needsPinning |
| 143 | `transport/StopRowsEditor.tsx` | 1 | 4 | no | predictions |
| 144 | `website/Publications.tsx` | 1 | 4 | no | shown |
| 145 | `dashboard/ModuleDashboard.tsx` | 1 | 3 | no | kpi.breakdown |
| 146 | `payroll/AdvancesPanel.tsx` | 1 | 3 | no | a.recoveries |
| 147 | `payroll/StaffSelfService.tsx` | 1 | 3 | no | a.recoveries |
| 148 | `students/CurriculumOfficePanel.tsx` | 1 | 3 | no | students |
