import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_hi.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of L
/// returned by `L.of(context)`.
///
/// Applications need to include `L.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: L.localizationsDelegates,
///   supportedLocales: L.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the L.supportedLocales
/// property.
abstract class L {
  L(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static L of(BuildContext context) {
    return Localizations.of<L>(context, L)!;
  }

  static const LocalizationsDelegate<L> delegate = _LDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('hi'),
  ];

  /// No description provided for @languageName.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageName;

  /// No description provided for @chooseLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get chooseLanguage;

  /// No description provided for @english.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get english;

  /// No description provided for @hindi.
  ///
  /// In en, this message translates to:
  /// **'हिन्दी'**
  String get hindi;

  /// No description provided for @backToSignIn.
  ///
  /// In en, this message translates to:
  /// **'Back to sign in'**
  String get backToSignIn;

  /// No description provided for @changeMobileNumber.
  ///
  /// In en, this message translates to:
  /// **'Change mobile number'**
  String get changeMobileNumber;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @schoolEmail.
  ///
  /// In en, this message translates to:
  /// **'School email'**
  String get schoolEmail;

  /// No description provided for @digitCodeFromWhatsapp.
  ///
  /// In en, this message translates to:
  /// **'6-digit code from WhatsApp'**
  String get digitCodeFromWhatsapp;

  /// No description provided for @otp.
  ///
  /// In en, this message translates to:
  /// **'OTP'**
  String get otp;

  /// No description provided for @digitWhatsappNumber.
  ///
  /// In en, this message translates to:
  /// **'10-digit WhatsApp number'**
  String get digitWhatsappNumber;

  /// No description provided for @mobileNumber.
  ///
  /// In en, this message translates to:
  /// **'Mobile number'**
  String get mobileNumber;

  /// No description provided for @staff.
  ///
  /// In en, this message translates to:
  /// **'Staff'**
  String get staff;

  /// No description provided for @parent.
  ///
  /// In en, this message translates to:
  /// **'Parent'**
  String get parent;

  /// No description provided for @chatWithTheSchoolOnWhatsapp.
  ///
  /// In en, this message translates to:
  /// **'Chat with the school on WhatsApp'**
  String get chatWithTheSchoolOnWhatsapp;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @notices.
  ///
  /// In en, this message translates to:
  /// **'Notices'**
  String get notices;

  /// No description provided for @noActiveStudentsFoundForThis.
  ///
  /// In en, this message translates to:
  /// **'No active students found for this account. Contact the school office.'**
  String get noActiveStudentsFoundForThis;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// No description provided for @showThisQrAtTheSchool.
  ///
  /// In en, this message translates to:
  /// **'Show this QR at the school gate, library or fee counter.'**
  String get showThisQrAtTheSchool;

  /// No description provided for @noAdmissionNumberOnRecordYet.
  ///
  /// In en, this message translates to:
  /// **'No admission number on record yet — contact the school office.'**
  String get noAdmissionNumberOnRecordYet;

  /// No description provided for @bhbInternationalSchool.
  ///
  /// In en, this message translates to:
  /// **'BHB INTERNATIONAL SCHOOL'**
  String get bhbInternationalSchool;

  /// No description provided for @studentId.
  ///
  /// In en, this message translates to:
  /// **'Student ID'**
  String get studentId;

  /// No description provided for @dayByDay.
  ///
  /// In en, this message translates to:
  /// **'Day by day'**
  String get dayByDay;

  /// No description provided for @noAttendanceMarkedYetThisTerm.
  ///
  /// In en, this message translates to:
  /// **'No attendance marked yet this term. Records appear here the day the class teacher marks the register.'**
  String get noAttendanceMarkedYetThisTerm;

  /// No description provided for @allPublishedSchoolBusRoutesAsk.
  ///
  /// In en, this message translates to:
  /// **'All published school bus routes. Ask the office which one your child is on.'**
  String get allPublishedSchoolBusRoutesAsk;

  /// No description provided for @noBusRoutesPublishedYetContact.
  ///
  /// In en, this message translates to:
  /// **'No bus routes published yet. Contact the school office to find your child\'s route.'**
  String get noBusRoutesPublishedYetContact;

  /// No description provided for @youReNotSetAsA.
  ///
  /// In en, this message translates to:
  /// **'You\'re not set as a class teacher for any section, so there\'s no parent inbox here yet.'**
  String get youReNotSetAsA;

  /// No description provided for @typeAMessage.
  ///
  /// In en, this message translates to:
  /// **'Type a message…'**
  String get typeAMessage;

  /// No description provided for @couldNotSendCheckYourConnection.
  ///
  /// In en, this message translates to:
  /// **'Could not send. Check your connection.'**
  String get couldNotSendCheckYourConnection;

  /// No description provided for @whatHappenedWhenAndWhatYou.
  ///
  /// In en, this message translates to:
  /// **'What happened, when, and what you would like the school to do'**
  String get whatHappenedWhenAndWhatYou;

  /// No description provided for @details.
  ///
  /// In en, this message translates to:
  /// **'Details'**
  String get details;

  /// No description provided for @subject.
  ///
  /// In en, this message translates to:
  /// **'Subject'**
  String get subject;

  /// No description provided for @generalNotAboutOneChild.
  ///
  /// In en, this message translates to:
  /// **'General — not about one child'**
  String get generalNotAboutOneChild;

  /// No description provided for @concerning.
  ///
  /// In en, this message translates to:
  /// **'Concerning'**
  String get concerning;

  /// No description provided for @whatIsItAbout.
  ///
  /// In en, this message translates to:
  /// **'What is it about?'**
  String get whatIsItAbout;

  /// No description provided for @raiseAComplaint.
  ///
  /// In en, this message translates to:
  /// **'Raise a complaint'**
  String get raiseAComplaint;

  /// No description provided for @couldNotReachTheSchoolServer.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the school server.'**
  String get couldNotReachTheSchoolServer;

  /// No description provided for @pleaseFillInTheSubjectAnd.
  ///
  /// In en, this message translates to:
  /// **'Please fill in the subject and the details.'**
  String get pleaseFillInTheSubjectAnd;

  /// No description provided for @noComplaintsRaisedIfSomethingAt.
  ///
  /// In en, this message translates to:
  /// **'No complaints raised. If something at school needs the office\'s attention, use the button below.'**
  String get noComplaintsRaisedIfSomethingAt;

  /// No description provided for @couldNotOpenThisBook.
  ///
  /// In en, this message translates to:
  /// **'Could not open this book.'**
  String get couldNotOpenThisBook;

  /// No description provided for @noIndividualBooksCataloguedYetThe.
  ///
  /// In en, this message translates to:
  /// **'No individual books catalogued yet — the shelf link above has everything the library has published.'**
  String get noIndividualBooksCataloguedYetThe;

  /// No description provided for @openTheWholeShelf.
  ///
  /// In en, this message translates to:
  /// **'Open the whole shelf'**
  String get openTheWholeShelf;

  /// No description provided for @theSchoolSEBookShelf.
  ///
  /// In en, this message translates to:
  /// **'The school\'s e-book shelf is not switched on yet. Books appear here as soon as the library sets it up.'**
  String get theSchoolSEBookShelf;

  /// No description provided for @everyPaymentSoFarAsA.
  ///
  /// In en, this message translates to:
  /// **'Every payment so far, as a PDF'**
  String get everyPaymentSoFarAsA;

  /// No description provided for @previousReceipts.
  ///
  /// In en, this message translates to:
  /// **'Previous receipts'**
  String get previousReceipts;

  /// No description provided for @notDueYetTickAnyYou.
  ///
  /// In en, this message translates to:
  /// **'Not due yet. Tick any you would like to clear now.'**
  String get notDueYetTickAnyYou;

  /// No description provided for @tickTheFeesYouWantTo.
  ///
  /// In en, this message translates to:
  /// **'Tick the fees you want to pay now.'**
  String get tickTheFeesYouWantTo;

  /// No description provided for @totalDue.
  ///
  /// In en, this message translates to:
  /// **'Total due'**
  String get totalDue;

  /// No description provided for @noPendingFeesAllDuesAre.
  ///
  /// In en, this message translates to:
  /// **'No pending fees — all dues are cleared. Thank you!'**
  String get noPendingFeesAllDuesAre;

  /// No description provided for @checkingForYourPaymentPaidDues.
  ///
  /// In en, this message translates to:
  /// **'Checking for your payment. Paid dues disappear from this list once the bank confirms — usually within a minute.'**
  String get checkingForYourPaymentPaidDues;

  /// No description provided for @noAlbumsPublishedYetPhotosFrom.
  ///
  /// In en, this message translates to:
  /// **'No albums published yet. Photos from school events appear here.'**
  String get noAlbumsPublishedYetPhotosFrom;

  /// No description provided for @publish.
  ///
  /// In en, this message translates to:
  /// **'Publish'**
  String get publish;

  /// No description provided for @homeworkDetailsForParents.
  ///
  /// In en, this message translates to:
  /// **'Homework details for parents…'**
  String get homeworkDetailsForParents;

  /// No description provided for @title.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get title;

  /// No description provided for @postHomework.
  ///
  /// In en, this message translates to:
  /// **'Post homework'**
  String get postHomework;

  /// No description provided for @askTutor.
  ///
  /// In en, this message translates to:
  /// **'Ask tutor'**
  String get askTutor;

  /// No description provided for @eGFeverDoctorAdvisedRest.
  ///
  /// In en, this message translates to:
  /// **'e.g. Fever — doctor advised rest'**
  String get eGFeverDoctorAdvisedRest;

  /// No description provided for @reason.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get reason;

  /// No description provided for @typeOfLeave.
  ///
  /// In en, this message translates to:
  /// **'Type of leave'**
  String get typeOfLeave;

  /// No description provided for @pleaseGiveAReason.
  ///
  /// In en, this message translates to:
  /// **'Please give a reason.'**
  String get pleaseGiveAReason;

  /// No description provided for @withdraw.
  ///
  /// In en, this message translates to:
  /// **'Withdraw'**
  String get withdraw;

  /// No description provided for @keep.
  ///
  /// In en, this message translates to:
  /// **'Keep'**
  String get keep;

  /// No description provided for @withdrawThisRequest.
  ///
  /// In en, this message translates to:
  /// **'Withdraw this request?'**
  String get withdrawThisRequest;

  /// No description provided for @withdrawRequest.
  ///
  /// In en, this message translates to:
  /// **'Withdraw request'**
  String get withdrawRequest;

  /// No description provided for @requestLeave.
  ///
  /// In en, this message translates to:
  /// **'Request leave'**
  String get requestLeave;

  /// No description provided for @covers.
  ///
  /// In en, this message translates to:
  /// **'COVERS'**
  String get covers;

  /// No description provided for @lessonTitle.
  ///
  /// In en, this message translates to:
  /// **'Lesson title'**
  String get lessonTitle;

  /// No description provided for @tapSpeakOnAnyBoxTo.
  ///
  /// In en, this message translates to:
  /// **'Tap Speak on any box to dictate instead of typing.'**
  String get tapSpeakOnAnyBoxTo;

  /// No description provided for @newLessonPlan.
  ///
  /// In en, this message translates to:
  /// **'New lesson plan'**
  String get newLessonPlan;

  /// No description provided for @noNoticesPublishedYetSchoolCirculars.
  ///
  /// In en, this message translates to:
  /// **'No notices published yet. School circulars and news will appear here.'**
  String get noNoticesPublishedYetSchoolCirculars;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @chooseASlot.
  ///
  /// In en, this message translates to:
  /// **'Choose a slot'**
  String get chooseASlot;

  /// No description provided for @bookingCancelled.
  ///
  /// In en, this message translates to:
  /// **'Booking cancelled'**
  String get bookingCancelled;

  /// No description provided for @slotBookedSeeYouThere.
  ///
  /// In en, this message translates to:
  /// **'Slot booked — see you there!'**
  String get slotBookedSeeYouThere;

  /// No description provided for @book.
  ///
  /// In en, this message translates to:
  /// **'Book'**
  String get book;

  /// No description provided for @bookThisSlot.
  ///
  /// In en, this message translates to:
  /// **'Book this slot?'**
  String get bookThisSlot;

  /// No description provided for @couldNotFetchTheReceiptCheck.
  ///
  /// In en, this message translates to:
  /// **'Could not fetch the receipt. Check your connection.'**
  String get couldNotFetchTheReceiptCheck;

  /// No description provided for @fetchingReceipt.
  ///
  /// In en, this message translates to:
  /// **'Fetching receipt…'**
  String get fetchingReceipt;

  /// No description provided for @noReceiptsYetEveryPaymentMade.
  ///
  /// In en, this message translates to:
  /// **'No receipts yet. Every payment made at the counter or online appears here.'**
  String get noReceiptsYetEveryPaymentMade;

  /// No description provided for @guess.
  ///
  /// In en, this message translates to:
  /// **'guess'**
  String get guess;

  /// No description provided for @discard.
  ///
  /// In en, this message translates to:
  /// **'Discard'**
  String get discard;

  /// No description provided for @addToPlan.
  ///
  /// In en, this message translates to:
  /// **'Add to plan'**
  String get addToPlan;

  /// No description provided for @pickTheClassAndSubjectFirst.
  ///
  /// In en, this message translates to:
  /// **'Pick the class and subject first.'**
  String get pickTheClassAndSubjectFirst;

  /// No description provided for @gallery.
  ///
  /// In en, this message translates to:
  /// **'Gallery'**
  String get gallery;

  /// No description provided for @camera.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get camera;

  /// No description provided for @photographTheContentsPageOfThe.
  ///
  /// In en, this message translates to:
  /// **'Photograph the contents page of the textbook. Chapters and topics are detected for you to check before they are added.'**
  String get photographTheContentsPageOfThe;

  /// No description provided for @scanSyllabus.
  ///
  /// In en, this message translates to:
  /// **'Scan syllabus'**
  String get scanSyllabus;

  /// No description provided for @chatInApp.
  ///
  /// In en, this message translates to:
  /// **'Chat in app'**
  String get chatInApp;

  /// No description provided for @noTeachersAreLinkedToThis.
  ///
  /// In en, this message translates to:
  /// **'No teachers are linked to this class yet. The school office assigns the class teacher and publishes the timetable.'**
  String get noTeachersAreLinkedToThis;

  /// No description provided for @whatsappIsNotInstalledOnThis.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp is not installed on this phone.'**
  String get whatsappIsNotInstalledOnThis;

  /// No description provided for @content.
  ///
  /// In en, this message translates to:
  /// **'CONTENT'**
  String get content;

  /// No description provided for @notTaught.
  ///
  /// In en, this message translates to:
  /// **'Not taught'**
  String get notTaught;

  /// No description provided for @thatLinkIsNotAValid.
  ///
  /// In en, this message translates to:
  /// **'That link is not a valid web address.'**
  String get thatLinkIsNotAValid;

  /// No description provided for @nothingToLog.
  ///
  /// In en, this message translates to:
  /// **'Nothing to log'**
  String get nothingToLog;

  /// No description provided for @noPeriodsOnYourTimetableToday.
  ///
  /// In en, this message translates to:
  /// **'No periods on your timetable today.'**
  String get noPeriodsOnYourTimetableToday;

  /// No description provided for @writeANewLessonPlan.
  ///
  /// In en, this message translates to:
  /// **'Write a new lesson plan'**
  String get writeANewLessonPlan;

  /// No description provided for @noLessonPlansForThisSubject.
  ///
  /// In en, this message translates to:
  /// **'No lesson plans for this subject yet.'**
  String get noLessonPlansForThisSubject;

  /// No description provided for @whichLessonPlan.
  ///
  /// In en, this message translates to:
  /// **'Which lesson plan?'**
  String get whichLessonPlan;

  /// No description provided for @whatDidYouCover.
  ///
  /// In en, this message translates to:
  /// **'What did you cover?'**
  String get whatDidYouCover;

  /// No description provided for @noSyllabusPlanSetForThis.
  ///
  /// In en, this message translates to:
  /// **'No syllabus plan set for this subject yet.'**
  String get noSyllabusPlanSetForThis;

  /// No description provided for @anythingElse.
  ///
  /// In en, this message translates to:
  /// **'Anything else'**
  String get anythingElse;

  /// No description provided for @preferredStopIfYouKnowOne.
  ///
  /// In en, this message translates to:
  /// **'Preferred stop (if you know one)'**
  String get preferredStopIfYouKnowOne;

  /// No description provided for @landmark.
  ///
  /// In en, this message translates to:
  /// **'Landmark'**
  String get landmark;

  /// No description provided for @localityVillage.
  ///
  /// In en, this message translates to:
  /// **'Locality / village'**
  String get localityVillage;

  /// No description provided for @pickupAddress.
  ///
  /// In en, this message translates to:
  /// **'Pickup address'**
  String get pickupAddress;

  /// No description provided for @tellTheSchoolWhereToPick.
  ///
  /// In en, this message translates to:
  /// **'Tell the school where to pick up from. The transport in-charge will call to confirm the stop and the monthly fee.'**
  String get tellTheSchoolWhereToPick;

  /// No description provided for @pleaseGiveThePickupAddress.
  ///
  /// In en, this message translates to:
  /// **'Please give the pickup address.'**
  String get pleaseGiveThePickupAddress;

  /// No description provided for @requestSentTheSchoolWillGet.
  ///
  /// In en, this message translates to:
  /// **'Request sent. The school will get in touch.'**
  String get requestSentTheSchoolWillGet;

  /// No description provided for @theTransportInChargeWillCall.
  ///
  /// In en, this message translates to:
  /// **'The transport in-charge will call you about the stop and the fee.'**
  String get theTransportInChargeWillCall;

  /// No description provided for @notUsingSchoolTransport.
  ///
  /// In en, this message translates to:
  /// **'Not using school transport.'**
  String get notUsingSchoolTransport;

  /// No description provided for @driverSNumberIsNotOn.
  ///
  /// In en, this message translates to:
  /// **'Driver\'s number is not on the school\'s record yet.'**
  String get driverSNumberIsNotOn;

  /// No description provided for @call.
  ///
  /// In en, this message translates to:
  /// **'Call'**
  String get call;

  /// No description provided for @boardingIsPausedByTheOffice.
  ///
  /// In en, this message translates to:
  /// **'Boarding is paused by the office at the moment.'**
  String get boardingIsPausedByTheOffice;

  /// No description provided for @seeAllBusRoutesAndStops.
  ///
  /// In en, this message translates to:
  /// **'See all bus routes and stops'**
  String get seeAllBusRoutesAndStops;

  /// No description provided for @voiceInputIsNotAvailableOn.
  ///
  /// In en, this message translates to:
  /// **'Voice input is not available on this phone. Please type your question.'**
  String get voiceInputIsNotAvailableOn;

  /// No description provided for @repliesAreWrittenByAnAi.
  ///
  /// In en, this message translates to:
  /// **'Replies are written by an AI and can be wrong. Check anything that matters with the class teacher.'**
  String get repliesAreWrittenByAnAi;

  /// No description provided for @howToUseTheTutorAs.
  ///
  /// In en, this message translates to:
  /// **'How to use the tutor as daily tuition · रोज़ की ट्यूशन कैसे करें'**
  String get howToUseTheTutorAs;

  /// No description provided for @theTutorIsNotSwitchedOn.
  ///
  /// In en, this message translates to:
  /// **'The tutor is not switched on yet. Please check back later.'**
  String get theTutorIsNotSwitchedOn;

  /// No description provided for @howToUseTheTutor.
  ///
  /// In en, this message translates to:
  /// **'How to use the tutor'**
  String get howToUseTheTutor;

  /// No description provided for @aiTutor.
  ///
  /// In en, this message translates to:
  /// **'AI tutor'**
  String get aiTutor;

  /// No description provided for @fromYoutubeNotTheSchoolJudge.
  ///
  /// In en, this message translates to:
  /// **'From YouTube, not the school — judge it as you watch.'**
  String get fromYoutubeNotTheSchoolJudge;

  /// No description provided for @fromDikshaGovernmentLessons.
  ///
  /// In en, this message translates to:
  /// **'From DIKSHA, the Government of India\'s platform for NCERT and CBSE lessons.'**
  String get fromDikshaGovernmentLessons;

  /// No description provided for @chooseAPdfOrFile.
  ///
  /// In en, this message translates to:
  /// **'Choose a PDF or file'**
  String get chooseAPdfOrFile;

  /// No description provided for @chooseFromGallery.
  ///
  /// In en, this message translates to:
  /// **'Choose from gallery'**
  String get chooseFromGallery;

  /// No description provided for @takeAPhoto.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get takeAPhoto;

  /// No description provided for @couldNotReachTheSchoolServer2.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the school server. Nothing was uploaded.'**
  String get couldNotReachTheSchoolServer2;

  /// No description provided for @ok.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get ok;

  /// No description provided for @done.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get done;

  /// No description provided for @automaticCheck.
  ///
  /// In en, this message translates to:
  /// **'Automatic check'**
  String get automaticCheck;

  /// No description provided for @submittedSuccessfully.
  ///
  /// In en, this message translates to:
  /// **'Submitted successfully'**
  String get submittedSuccessfully;

  /// No description provided for @checkingAndUploading.
  ///
  /// In en, this message translates to:
  /// **'Checking and uploading…'**
  String get checkingAndUploading;

  /// No description provided for @replace.
  ///
  /// In en, this message translates to:
  /// **'Replace'**
  String get replace;

  /// No description provided for @theOfficeHasAlreadyVerifiedThis.
  ///
  /// In en, this message translates to:
  /// **'The office has already verified this one. A new upload goes back to them for verification.'**
  String get theOfficeHasAlreadyVerifiedThis;

  /// No description provided for @replaceAVerifiedDocument.
  ///
  /// In en, this message translates to:
  /// **'Replace a verified document?'**
  String get replaceAVerifiedDocument;

  /// No description provided for @somethingWrongInTheRecordTell.
  ///
  /// In en, this message translates to:
  /// **'Something wrong in the record? Tell the school office — these details are changed there, with your documents in hand.'**
  String get somethingWrongInTheRecordTell;

  /// No description provided for @uploadAClearPhotoOrScan.
  ///
  /// In en, this message translates to:
  /// **'Upload a clear photo or scan of each. The office verifies every document; you will see the result here.'**
  String get uploadAClearPhotoOrScan;

  /// No description provided for @thisChildIsNoLongerOn.
  ///
  /// In en, this message translates to:
  /// **'This child is no longer on your account.'**
  String get thisChildIsNoLongerOn;

  /// No description provided for @updateFamilyDetails.
  ///
  /// In en, this message translates to:
  /// **'Update family details'**
  String get updateFamilyDetails;

  /// No description provided for @savedTheSchoolOfficeCanSee.
  ///
  /// In en, this message translates to:
  /// **'Saved. The school office can see the update.'**
  String get savedTheSchoolOfficeCanSee;

  /// No description provided for @whatWasSaid.
  ///
  /// In en, this message translates to:
  /// **'What was said'**
  String get whatWasSaid;

  /// No description provided for @logCall.
  ///
  /// In en, this message translates to:
  /// **'Log call'**
  String get logCall;

  /// No description provided for @whatsapp.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp'**
  String get whatsapp;

  /// No description provided for @searchChildParentOrMobile.
  ///
  /// In en, this message translates to:
  /// **'Search child, parent or mobile'**
  String get searchChildParentOrMobile;

  /// No description provided for @nothingToCallRightNow.
  ///
  /// In en, this message translates to:
  /// **'Nothing to call right now.'**
  String get nothingToCallRightNow;

  /// No description provided for @alreadyMarkedTodaySavingAgainWill.
  ///
  /// In en, this message translates to:
  /// **'Already marked today — saving again will update the register.'**
  String get alreadyMarkedTodaySavingAgainWill;

  /// No description provided for @noActiveStudentsInThisSection.
  ///
  /// In en, this message translates to:
  /// **'No active students in this section.'**
  String get noActiveStudentsInThisSection;

  /// No description provided for @attendanceSaved.
  ///
  /// In en, this message translates to:
  /// **'Attendance saved'**
  String get attendanceSaved;

  /// No description provided for @goesOutOnWhatsappFromThe.
  ///
  /// In en, this message translates to:
  /// **'Goes out on WhatsApp from the school number and as a push notification to families/staff using the app. Parents who replied STOP are skipped automatically. Every send is logged in the ERP\'s household message log.'**
  String get goesOutOnWhatsappFromThe;

  /// No description provided for @previewRecipients.
  ///
  /// In en, this message translates to:
  /// **'Preview recipients'**
  String get previewRecipients;

  /// No description provided for @nothingHasBeenSentYetReview.
  ///
  /// In en, this message translates to:
  /// **'Nothing has been sent yet. Review the message above, then confirm.'**
  String get nothingHasBeenSentYetReview;

  /// No description provided for @sent.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get sent;

  /// No description provided for @freeTextOnlyReachesRecipientsWho.
  ///
  /// In en, this message translates to:
  /// **'Free text only reaches recipients who messaged the school\'s WhatsApp number in the last 24 hours — Meta blocks it outside that window. Pick an approved template above to reach everyone.'**
  String get freeTextOnlyReachesRecipientsWho;

  /// No description provided for @eGSchoolWillRemainClosed.
  ///
  /// In en, this message translates to:
  /// **'e.g. School will remain closed tomorrow on account of heavy rain. Classes resume Wednesday.'**
  String get eGSchoolWillRemainClosed;

  /// No description provided for @message.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get message;

  /// No description provided for @theSameValueIsUsedFor.
  ///
  /// In en, this message translates to:
  /// **'The same value is used for every recipient — a school-wide send has no per-person data to fill placeholders with.'**
  String get theSameValueIsUsedFor;

  /// No description provided for @approvedTemplateReachesEveryRecipientRegardl.
  ///
  /// In en, this message translates to:
  /// **'Approved template · reaches every recipient regardless of the 24-hour window.'**
  String get approvedTemplateReachesEveryRecipientRegardl;

  /// No description provided for @freeTextHourWindowOnly.
  ///
  /// In en, this message translates to:
  /// **'Free text (24-hour window only)'**
  String get freeTextHourWindowOnly;

  /// No description provided for @loadingApprovedTemplates.
  ///
  /// In en, this message translates to:
  /// **'Loading approved templates…'**
  String get loadingApprovedTemplates;

  /// No description provided for @messageType.
  ///
  /// In en, this message translates to:
  /// **'Message type'**
  String get messageType;

  /// No description provided for @allStaff.
  ///
  /// In en, this message translates to:
  /// **'All staff'**
  String get allStaff;

  /// No description provided for @allParents.
  ///
  /// In en, this message translates to:
  /// **'All parents'**
  String get allParents;

  /// No description provided for @audience.
  ///
  /// In en, this message translates to:
  /// **'Audience'**
  String get audience;

  /// No description provided for @broadcastMessage.
  ///
  /// In en, this message translates to:
  /// **'Broadcast message'**
  String get broadcastMessage;

  /// No description provided for @sendToEveryone.
  ///
  /// In en, this message translates to:
  /// **'Send to everyone?'**
  String get sendToEveryone;

  /// No description provided for @gpsPunchInAndOutAt.
  ///
  /// In en, this message translates to:
  /// **'GPS punch in and out at school'**
  String get gpsPunchInAndOutAt;

  /// No description provided for @markMyAttendance.
  ///
  /// In en, this message translates to:
  /// **'Mark my attendance · हाज़िरी लगाएँ'**
  String get markMyAttendance;

  /// No description provided for @reject.
  ///
  /// In en, this message translates to:
  /// **'Reject'**
  String get reject;

  /// No description provided for @back.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get back;

  /// No description provided for @eGBlurredWrongChildExpired.
  ///
  /// In en, this message translates to:
  /// **'e.g. blurred, wrong child, expired'**
  String get eGBlurredWrongChildExpired;

  /// No description provided for @whyTheParentReadsThis.
  ///
  /// In en, this message translates to:
  /// **'Why — the parent reads this'**
  String get whyTheParentReadsThis;

  /// No description provided for @rejectDocument.
  ///
  /// In en, this message translates to:
  /// **'Reject document'**
  String get rejectDocument;

  /// No description provided for @transportRequestsFromParents.
  ///
  /// In en, this message translates to:
  /// **'Transport requests from parents'**
  String get transportRequestsFromParents;

  /// No description provided for @theParentHasBeenNotifiedIn.
  ///
  /// In en, this message translates to:
  /// **'The parent has been notified in their app.'**
  String get theParentHasBeenNotifiedIn;

  /// No description provided for @nothingOutstanding.
  ///
  /// In en, this message translates to:
  /// **'Nothing outstanding.'**
  String get nothingOutstanding;

  /// No description provided for @takeMoney.
  ///
  /// In en, this message translates to:
  /// **'Take money'**
  String get takeMoney;

  /// No description provided for @aReceiptIsIssuedAtOnce.
  ///
  /// In en, this message translates to:
  /// **'A receipt is issued at once and the parent is notified.'**
  String get aReceiptIsIssuedAtOnce;

  /// No description provided for @partPaymentIsAllowedMoreThan.
  ///
  /// In en, this message translates to:
  /// **'Part payment is allowed; more than the balance is not'**
  String get partPaymentIsAllowedMoreThan;

  /// No description provided for @payingNow.
  ///
  /// In en, this message translates to:
  /// **'Paying now (₹)'**
  String get payingNow;

  /// No description provided for @nobodyMatchedTryTheAdmissionNumber.
  ///
  /// In en, this message translates to:
  /// **'Nobody matched. Try the admission number, or the parent\'s mobile.'**
  String get nobodyMatchedTryTheAdmissionNumber;

  /// No description provided for @nameAdmissionNoOrMobile.
  ///
  /// In en, this message translates to:
  /// **'Name, admission no. or mobile'**
  String get nameAdmissionNoOrMobile;

  /// No description provided for @collectFees.
  ///
  /// In en, this message translates to:
  /// **'Collect fees'**
  String get collectFees;

  /// No description provided for @noteOptional.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get noteOptional;

  /// No description provided for @about.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get about;

  /// No description provided for @collect.
  ///
  /// In en, this message translates to:
  /// **'Collect'**
  String get collect;

  /// No description provided for @approve.
  ///
  /// In en, this message translates to:
  /// **'Approve'**
  String get approve;

  /// No description provided for @noDateSheetHasBeenPublished.
  ///
  /// In en, this message translates to:
  /// **'No date sheet has been published for this year yet.'**
  String get noDateSheetHasBeenPublished;

  /// No description provided for @stay.
  ///
  /// In en, this message translates to:
  /// **'Stay'**
  String get stay;

  /// No description provided for @discardUnsavedMarks.
  ///
  /// In en, this message translates to:
  /// **'Discard unsaved marks?'**
  String get discardUnsavedMarks;

  /// No description provided for @noExamSubjectsAreLinkedTo.
  ///
  /// In en, this message translates to:
  /// **'No exam subjects are linked to this class yet. The exams desk links subjects from Masters.'**
  String get noExamSubjectsAreLinkedTo;

  /// No description provided for @examDateSheet.
  ///
  /// In en, this message translates to:
  /// **'Exam date sheet'**
  String get examDateSheet;

  /// No description provided for @noExamIsSetUpFor.
  ///
  /// In en, this message translates to:
  /// **'No exam is set up for this year yet. The exams desk creates terms (unit tests, half-yearly, annual) and mark entry opens here.'**
  String get noExamIsSetUpFor;

  /// No description provided for @youHaveNotCollectedAnythingToday.
  ///
  /// In en, this message translates to:
  /// **'You have not collected anything today.'**
  String get youHaveNotCollectedAnythingToday;

  /// No description provided for @itAppearsHereOnceTheOffice.
  ///
  /// In en, this message translates to:
  /// **'It appears here once the office approves the payroll.'**
  String get itAppearsHereOnceTheOffice;

  /// No description provided for @noPayslipHasBeenReleasedYet.
  ///
  /// In en, this message translates to:
  /// **'No payslip has been released yet. One appears here for each month once the office approves that month\'s payroll.'**
  String get noPayslipHasBeenReleasedYet;

  /// No description provided for @stopSharing.
  ///
  /// In en, this message translates to:
  /// **'Stop sharing'**
  String get stopSharing;

  /// No description provided for @androidWillAskForLocationAccess.
  ///
  /// In en, this message translates to:
  /// **'Android will ask for location access — choose “Allow all the time” so sharing continues with the app closed. A permanent notification shows while sharing.'**
  String get androidWillAskForLocationAccess;

  /// No description provided for @byStartingYouAgreeThatThe.
  ///
  /// In en, this message translates to:
  /// **'By starting, you agree that the school receives your phone\'s location during school timing on working days to confirm presence on campus, and may alert the management when you are off campus or your location is unavailable. Only your latest position and incidents are kept — not a movement trail. You can stop any time (stopping during school timing is flagged).'**
  String get byStartingYouAgreeThatThe;

  /// No description provided for @theSchoolHasNotEnabledPresence.
  ///
  /// In en, this message translates to:
  /// **'The school has not enabled presence tracking yet.'**
  String get theSchoolHasNotEnabledPresence;

  /// No description provided for @schoolPresence.
  ///
  /// In en, this message translates to:
  /// **'School presence'**
  String get schoolPresence;

  /// No description provided for @figuresUpdateLiveFromTheSchool.
  ///
  /// In en, this message translates to:
  /// **'Figures update live from the school ERP. Pull down to refresh.'**
  String get figuresUpdateLiveFromTheSchool;

  /// No description provided for @tapToSeeRegistersBySection.
  ///
  /// In en, this message translates to:
  /// **'Tap to see registers by section'**
  String get tapToSeeRegistersBySection;

  /// No description provided for @noSectionsMarkedYetToday.
  ///
  /// In en, this message translates to:
  /// **'No sections marked yet today.'**
  String get noSectionsMarkedYetToday;

  /// No description provided for @couldNotLoadTheClassList.
  ///
  /// In en, this message translates to:
  /// **'Could not load the class list.'**
  String get couldNotLoadTheClassList;

  /// No description provided for @noFollowUpsAreDueNice.
  ///
  /// In en, this message translates to:
  /// **'No follow-ups are due. Nice.'**
  String get noFollowUpsAreDueNice;

  /// No description provided for @noActiveStaffOnTheRoster.
  ///
  /// In en, this message translates to:
  /// **'No active staff on the roster.'**
  String get noActiveStaffOnTheRoster;

  /// No description provided for @tapASectionToViewOr.
  ///
  /// In en, this message translates to:
  /// **'Tap a section to view or mark its register.'**
  String get tapASectionToViewOr;

  /// No description provided for @noActiveSectionsConfigured.
  ///
  /// In en, this message translates to:
  /// **'No active sections configured.'**
  String get noActiveSectionsConfigured;

  /// No description provided for @noMobileOnFile.
  ///
  /// In en, this message translates to:
  /// **'No mobile on file'**
  String get noMobileOnFile;

  /// No description provided for @whatsappIsNotAvailableOnThis.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp is not available on this phone.'**
  String get whatsappIsNotAvailableOnThis;

  /// No description provided for @couldNotOpenTheDialer.
  ///
  /// In en, this message translates to:
  /// **'Could not open the dialer.'**
  String get couldNotOpenTheDialer;

  /// No description provided for @addNote.
  ///
  /// In en, this message translates to:
  /// **'Add note'**
  String get addNote;

  /// No description provided for @metAddNote.
  ///
  /// In en, this message translates to:
  /// **'Met · add note'**
  String get metAddNote;

  /// No description provided for @didNotCome.
  ///
  /// In en, this message translates to:
  /// **'Did not come'**
  String get didNotCome;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @agreedFollowUp.
  ///
  /// In en, this message translates to:
  /// **'Agreed follow-up'**
  String get agreedFollowUp;

  /// No description provided for @needsAttention.
  ///
  /// In en, this message translates to:
  /// **'Needs attention'**
  String get needsAttention;

  /// No description provided for @doingWell.
  ///
  /// In en, this message translates to:
  /// **'Doing well'**
  String get doingWell;

  /// No description provided for @aShortNoteForTheParent.
  ///
  /// In en, this message translates to:
  /// **'A short note for the parent and the report card. All three are optional.'**
  String get aShortNoteForTheParent;

  /// No description provided for @noPtmSlotsAreYoursRight.
  ///
  /// In en, this message translates to:
  /// **'No PTM slots are yours right now. The office schedules PTM days and slots from the PTM desk.'**
  String get noPtmSlotsAreYoursRight;

  /// No description provided for @chooseClassSection.
  ///
  /// In en, this message translates to:
  /// **'Choose class & section'**
  String get chooseClassSection;

  /// No description provided for @bothPunchesRecordedForTodayHave.
  ///
  /// In en, this message translates to:
  /// **'Both punches recorded for today. Have a good evening!'**
  String get bothPunchesRecordedForTodayHave;

  /// No description provided for @selfPunchIsDisabledByThe.
  ///
  /// In en, this message translates to:
  /// **'Self punch is disabled by the school. Use the WhatsApp attendance number instead.'**
  String get selfPunchIsDisabledByThe;

  /// No description provided for @myAttendance.
  ///
  /// In en, this message translates to:
  /// **'My attendance'**
  String get myAttendance;

  /// No description provided for @couldNotPunchCheckTheConnection.
  ///
  /// In en, this message translates to:
  /// **'Could not punch. Check the connection.'**
  String get couldNotPunchCheckTheConnection;

  /// No description provided for @mockLocationIsOnFakeGps.
  ///
  /// In en, this message translates to:
  /// **'Mock location is ON (fake-GPS app / developer setting). Disable it — mock punches are rejected and flagged.'**
  String get mockLocationIsOnFakeGps;

  /// No description provided for @close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// No description provided for @resolve.
  ///
  /// In en, this message translates to:
  /// **'Resolve'**
  String get resolve;

  /// No description provided for @inProgress.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get inProgress;

  /// No description provided for @takeUp.
  ///
  /// In en, this message translates to:
  /// **'Take up'**
  String get takeUp;

  /// No description provided for @callParent.
  ///
  /// In en, this message translates to:
  /// **'Call parent'**
  String get callParent;

  /// No description provided for @theParentReadsThisInTheir.
  ///
  /// In en, this message translates to:
  /// **'The parent reads this in their app'**
  String get theParentReadsThisInTheir;

  /// No description provided for @whatWasDone.
  ///
  /// In en, this message translates to:
  /// **'What was done'**
  String get whatWasDone;

  /// No description provided for @resolveComplaint.
  ///
  /// In en, this message translates to:
  /// **'Resolve complaint'**
  String get resolveComplaint;

  /// No description provided for @shortAndClearThePrincipalReads.
  ///
  /// In en, this message translates to:
  /// **'Short and clear — the principal reads this'**
  String get shortAndClearThePrincipalReads;

  /// No description provided for @halfDay.
  ///
  /// In en, this message translates to:
  /// **'Half day'**
  String get halfDay;

  /// No description provided for @to.
  ///
  /// In en, this message translates to:
  /// **'to'**
  String get to;

  /// No description provided for @applyForLeave.
  ///
  /// In en, this message translates to:
  /// **'Apply for leave'**
  String get applyForLeave;

  /// No description provided for @noLeaveAppliedYetThisYear.
  ///
  /// In en, this message translates to:
  /// **'No leave applied yet this year.'**
  String get noLeaveAppliedYetThisYear;

  /// No description provided for @myRequests.
  ///
  /// In en, this message translates to:
  /// **'My requests'**
  String get myRequests;

  /// No description provided for @unpaid.
  ///
  /// In en, this message translates to:
  /// **'Unpaid'**
  String get unpaid;

  /// No description provided for @balanceThisYear.
  ///
  /// In en, this message translates to:
  /// **'Balance this year'**
  String get balanceThisYear;

  /// No description provided for @staffSignInWithAnOtp.
  ///
  /// In en, this message translates to:
  /// **'Staff sign in with an OTP sent to this number'**
  String get staffSignInWithAnOtp;

  /// No description provided for @digitMobile.
  ///
  /// In en, this message translates to:
  /// **'10-digit mobile'**
  String get digitMobile;

  /// No description provided for @waitingForThePrincipal.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the principal.'**
  String get waitingForThePrincipal;

  /// No description provided for @decline.
  ///
  /// In en, this message translates to:
  /// **'Decline'**
  String get decline;

  /// No description provided for @theAttendanceRegisterWillShowLeave.
  ///
  /// In en, this message translates to:
  /// **'The attendance register will show leave for these days.'**
  String get theAttendanceRegisterWillShowLeave;

  /// No description provided for @tellTheParentNowAppNotification.
  ///
  /// In en, this message translates to:
  /// **'Tell the parent now (app notification)'**
  String get tellTheParentNowAppNotification;

  /// No description provided for @referredToHospitalSentHome.
  ///
  /// In en, this message translates to:
  /// **'Referred to hospital / sent home'**
  String get referredToHospitalSentHome;

  /// No description provided for @sayWhatTheChildReported.
  ///
  /// In en, this message translates to:
  /// **'Say what the child reported.'**
  String get sayWhatTheChildReported;

  /// No description provided for @describeWhatHappened.
  ///
  /// In en, this message translates to:
  /// **'Describe what happened.'**
  String get describeWhatHappened;

  /// No description provided for @sickRoomFirstAid.
  ///
  /// In en, this message translates to:
  /// **'Sick room / first aid'**
  String get sickRoomFirstAid;

  /// No description provided for @disciplineNote.
  ///
  /// In en, this message translates to:
  /// **'Discipline note'**
  String get disciplineNote;

  /// No description provided for @meritGoodConduct.
  ///
  /// In en, this message translates to:
  /// **'Merit / good conduct'**
  String get meritGoodConduct;

  /// No description provided for @ageIsKeptAsTheParent.
  ///
  /// In en, this message translates to:
  /// **'Age is kept as the parent said it — an approximate age, never turned into a date of birth.'**
  String get ageIsKeptAsTheParent;

  /// No description provided for @theParentAgreedToBeContacted.
  ///
  /// In en, this message translates to:
  /// **'The parent agreed to be contacted by the school'**
  String get theParentAgreedToBeContacted;

  /// No description provided for @localityStreet.
  ///
  /// In en, this message translates to:
  /// **'Locality / street'**
  String get localityStreet;

  /// No description provided for @girl.
  ///
  /// In en, this message translates to:
  /// **'Girl'**
  String get girl;

  /// No description provided for @boy.
  ///
  /// In en, this message translates to:
  /// **'Boy'**
  String get boy;

  /// No description provided for @gender.
  ///
  /// In en, this message translates to:
  /// **'Gender'**
  String get gender;

  /// No description provided for @ageApprox.
  ///
  /// In en, this message translates to:
  /// **'Age (approx)'**
  String get ageApprox;

  /// No description provided for @classSought.
  ///
  /// In en, this message translates to:
  /// **'Class sought'**
  String get classSought;

  /// No description provided for @mobile.
  ///
  /// In en, this message translates to:
  /// **'Mobile'**
  String get mobile;

  /// No description provided for @parentSName.
  ///
  /// In en, this message translates to:
  /// **'Parent\'s name'**
  String get parentSName;

  /// No description provided for @childSName.
  ///
  /// In en, this message translates to:
  /// **'Child\'s name'**
  String get childSName;

  /// No description provided for @askTheParentBeforeRecordingTheir.
  ///
  /// In en, this message translates to:
  /// **'Ask the parent before recording their details.'**
  String get askTheParentBeforeRecordingTheir;

  /// No description provided for @chooseTheBeatYouAreWalking.
  ///
  /// In en, this message translates to:
  /// **'Choose the beat you are walking'**
  String get chooseTheBeatYouAreWalking;

  /// No description provided for @noSurveyBeatIsActiveThe.
  ///
  /// In en, this message translates to:
  /// **'No survey beat is active. The admissions desk sets the areas to canvass.'**
  String get noSurveyBeatIsActiveThe;

  /// No description provided for @modules.
  ///
  /// In en, this message translates to:
  /// **'Modules'**
  String get modules;

  /// No description provided for @noPeriodsForYouTodayOn.
  ///
  /// In en, this message translates to:
  /// **'No periods for you today on the published timetable.'**
  String get noPeriodsForYouTodayOn;

  /// No description provided for @todaySPeriods.
  ///
  /// In en, this message translates to:
  /// **'Today\'s periods'**
  String get todaySPeriods;

  /// No description provided for @shareLocationDuringSchoolHoursWorks.
  ///
  /// In en, this message translates to:
  /// **'Share location during school hours (works with app closed)'**
  String get shareLocationDuringSchoolHoursWorks;

  /// No description provided for @gpsPunchInOutFromCampus.
  ///
  /// In en, this message translates to:
  /// **'GPS punch in / out from campus'**
  String get gpsPunchInOutFromCampus;

  /// No description provided for @noPeriodsThisDay.
  ///
  /// In en, this message translates to:
  /// **'No periods this day.'**
  String get noPeriodsThisDay;

  /// No description provided for @thisWeekSArrangements.
  ///
  /// In en, this message translates to:
  /// **'This week\'s arrangements'**
  String get thisWeekSArrangements;

  /// No description provided for @workingDraftTheOfficeHasNot.
  ///
  /// In en, this message translates to:
  /// **'Working draft — the office has not published this timetable yet.'**
  String get workingDraftTheOfficeHasNot;

  /// No description provided for @noPeriodsAreAssignedToYou.
  ///
  /// In en, this message translates to:
  /// **'No periods are assigned to you on the timetable yet. The office publishes it from Timetable on the desk.'**
  String get noPeriodsAreAssignedToYou;

  /// No description provided for @noteForTheFamilyTheyWill.
  ///
  /// In en, this message translates to:
  /// **'Note for the family (they will see it)'**
  String get noteForTheFamilyTheyWill;

  /// No description provided for @assigned.
  ///
  /// In en, this message translates to:
  /// **'Assigned'**
  String get assigned;

  /// No description provided for @contacted.
  ///
  /// In en, this message translates to:
  /// **'Contacted'**
  String get contacted;

  /// No description provided for @nothingHereAParentSRequest.
  ///
  /// In en, this message translates to:
  /// **'Nothing here. A parent\'s request from the app appears the moment it is sent.'**
  String get nothingHereAParentSRequest;

  /// No description provided for @aadhaarLastLicenceNo.
  ///
  /// In en, this message translates to:
  /// **'Aadhaar last 4, licence no., …'**
  String get aadhaarLastLicenceNo;

  /// No description provided for @idShownOptional.
  ///
  /// In en, this message translates to:
  /// **'ID shown (optional)'**
  String get idShownOptional;

  /// No description provided for @whoAreTheyHereToMeet.
  ///
  /// In en, this message translates to:
  /// **'Who are they here to meet?'**
  String get whoAreTheyHereToMeet;

  /// No description provided for @whyAreTheyHere.
  ///
  /// In en, this message translates to:
  /// **'Why are they here?'**
  String get whyAreTheyHere;

  /// No description provided for @visitorSName.
  ///
  /// In en, this message translates to:
  /// **'Visitor\'s name'**
  String get visitorSName;

  /// No description provided for @checkThemOutInstead.
  ///
  /// In en, this message translates to:
  /// **'Check them out instead'**
  String get checkThemOutInstead;

  /// No description provided for @checkAVisitorIn.
  ///
  /// In en, this message translates to:
  /// **'Check a visitor in'**
  String get checkAVisitorIn;

  /// No description provided for @handOver.
  ///
  /// In en, this message translates to:
  /// **'Hand over'**
  String get handOver;

  /// No description provided for @out.
  ///
  /// In en, this message translates to:
  /// **'Out'**
  String get out;

  /// No description provided for @checkIn.
  ///
  /// In en, this message translates to:
  /// **'Check in'**
  String get checkIn;

  /// No description provided for @nameOfThePersonAtThe.
  ///
  /// In en, this message translates to:
  /// **'Name of the person at the gate'**
  String get nameOfThePersonAtThe;

  /// No description provided for @whoIsCollectingTheChild.
  ///
  /// In en, this message translates to:
  /// **'Who is collecting the child?'**
  String get whoIsCollectingTheChild;

  /// No description provided for @checkOut.
  ///
  /// In en, this message translates to:
  /// **'Check out'**
  String get checkOut;

  /// No description provided for @notYet.
  ///
  /// In en, this message translates to:
  /// **'Not yet'**
  String get notYet;

  /// No description provided for @classLabel.
  ///
  /// In en, this message translates to:
  /// **'Class'**
  String get classLabel;

  /// No description provided for @setLabel.
  ///
  /// In en, this message translates to:
  /// **'Set'**
  String get setLabel;

  /// No description provided for @leaveEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'No leave requested yet. Use the button below to tell the school when {name} will be away.'**
  String leaveEmptyHint(String name);

  /// No description provided for @withdrawLeaveBody.
  ///
  /// In en, this message translates to:
  /// **'The school will no longer see the leave request for {date}.'**
  String withdrawLeaveBody(String date);

  /// No description provided for @routeWay.
  ///
  /// In en, this message translates to:
  /// **'Route'**
  String get routeWay;

  /// No description provided for @takeAttendance.
  ///
  /// In en, this message translates to:
  /// **'Take attendance'**
  String get takeAttendance;

  /// No description provided for @noRoutesYet.
  ///
  /// In en, this message translates to:
  /// **'No routes yet. They appear here as soon as the office creates them.'**
  String get noRoutesYet;

  /// No description provided for @route.
  ///
  /// In en, this message translates to:
  /// **'Route'**
  String get route;

  /// No description provided for @gpsPunchCampus.
  ///
  /// In en, this message translates to:
  /// **'GPS punch in / out from campus'**
  String get gpsPunchCampus;

  /// No description provided for @myAttendanceHome.
  ///
  /// In en, this message translates to:
  /// **'My attendance'**
  String get myAttendanceHome;

  /// No description provided for @signOutCrew.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOutCrew;

  /// No description provided for @transport.
  ///
  /// In en, this message translates to:
  /// **'Transport'**
  String get transport;

  /// No description provided for @tryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get tryAgain;

  /// No description provided for @noStopOnMap.
  ///
  /// In en, this message translates to:
  /// **'No stop on this route is placed on the map — tell the office'**
  String get noStopOnMap;

  /// No description provided for @didNotBoard.
  ///
  /// In en, this message translates to:
  /// **'Did not come'**
  String get didNotBoard;

  /// No description provided for @change.
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get change;

  /// No description provided for @gettingLocation.
  ///
  /// In en, this message translates to:
  /// **'Getting location…'**
  String get gettingLocation;

  /// No description provided for @noChildrenAtStop.
  ///
  /// In en, this message translates to:
  /// **'No children at this stop'**
  String get noChildrenAtStop;

  /// No description provided for @noStopsOnRoute.
  ///
  /// In en, this message translates to:
  /// **'No stops on this route'**
  String get noStopsOnRoute;

  /// No description provided for @afternoonDrop.
  ///
  /// In en, this message translates to:
  /// **'Afternoon — drop'**
  String get afternoonDrop;

  /// No description provided for @morningPickup.
  ///
  /// In en, this message translates to:
  /// **'Morning — pick up'**
  String get morningPickup;

  /// No description provided for @refresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get refresh;

  /// No description provided for @expiresInMinutes.
  ///
  /// In en, this message translates to:
  /// **'Expires in 5 minutes'**
  String get expiresInMinutes;

  /// No description provided for @confirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get confirm;

  /// No description provided for @send.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get send;

  /// No description provided for @askTheErp.
  ///
  /// In en, this message translates to:
  /// **'Ask the ERP'**
  String get askTheErp;

  /// No description provided for @speak.
  ///
  /// In en, this message translates to:
  /// **'Speak'**
  String get speak;

  /// No description provided for @listening.
  ///
  /// In en, this message translates to:
  /// **'Listening…'**
  String get listening;

  /// No description provided for @couldNotHearYou.
  ///
  /// In en, this message translates to:
  /// **'Could not hear you'**
  String get couldNotHearYou;

  /// No description provided for @dictationNotAvailable.
  ///
  /// In en, this message translates to:
  /// **'Dictation is not available on this phone'**
  String get dictationNotAvailable;

  /// No description provided for @howWillYouPay.
  ///
  /// In en, this message translates to:
  /// **'How will you pay?'**
  String get howWillYouPay;

  /// No description provided for @schoolFeesAmount.
  ///
  /// In en, this message translates to:
  /// **'School fees {amount}'**
  String schoolFeesAmount(String amount);

  /// No description provided for @paymentChargeHint.
  ///
  /// In en, this message translates to:
  /// **'Some ways of paying carry a bank charge. Pick the one that suits you.'**
  String get paymentChargeHint;

  /// No description provided for @noExtraCharge.
  ///
  /// In en, this message translates to:
  /// **'No extra charge'**
  String get noExtraCharge;

  /// No description provided for @includesPaymentCharge.
  ///
  /// In en, this message translates to:
  /// **'Includes {amount} online payment charge'**
  String includesPaymentCharge(String amount);

  /// No description provided for @payFeesAutomatically.
  ///
  /// In en, this message translates to:
  /// **'Pay fees automatically'**
  String get payFeesAutomatically;

  /// No description provided for @autopayPitch.
  ///
  /// In en, this message translates to:
  /// **'Once a month, from day {day}, the school debits only the fee that is due — never more than {limit}. You get a WhatsApp message the day before.'**
  String autopayPitch(String day, String limit);

  /// No description provided for @setUpAutopay.
  ///
  /// In en, this message translates to:
  /// **'Set up auto-pay'**
  String get setUpAutopay;

  /// No description provided for @approveAutopay.
  ///
  /// In en, this message translates to:
  /// **'Approve auto-pay'**
  String get approveAutopay;

  /// No description provided for @autopayOnUpTo.
  ///
  /// In en, this message translates to:
  /// **'Auto-pay is on · up to {limit} a month'**
  String autopayOnUpTo(String limit);

  /// No description provided for @autopayLastDebit.
  ///
  /// In en, this message translates to:
  /// **'Last debit {amount} on {date}'**
  String autopayLastDebit(String amount, String date);

  /// No description provided for @stopAutopay.
  ///
  /// In en, this message translates to:
  /// **'Stop auto-pay'**
  String get stopAutopay;

  /// No description provided for @stopAutopayConfirm.
  ///
  /// In en, this message translates to:
  /// **'Stop paying fees automatically? You can set it up again later.'**
  String get stopAutopayConfirm;

  /// No description provided for @autopayStopped.
  ///
  /// In en, this message translates to:
  /// **'Auto-pay stopped'**
  String get autopayStopped;

  /// No description provided for @checkingYourAutopay.
  ///
  /// In en, this message translates to:
  /// **'Checking your auto-pay…'**
  String get checkingYourAutopay;

  /// No description provided for @updateRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Update the app to continue'**
  String get updateRequiredTitle;

  /// No description provided for @updateRequiredBody.
  ///
  /// In en, this message translates to:
  /// **'This version of the app no longer works with the school\'s system. Updating takes a minute and keeps everything you have.'**
  String get updateRequiredBody;

  /// No description provided for @updateNow.
  ///
  /// In en, this message translates to:
  /// **'Update now'**
  String get updateNow;

  /// No description provided for @updateDownloaded.
  ///
  /// In en, this message translates to:
  /// **'The update is downloaded.'**
  String get updateDownloaded;

  /// No description provided for @updateRestart.
  ///
  /// In en, this message translates to:
  /// **'Restart'**
  String get updateRestart;

  /// No description provided for @oclOnlineClasses.
  ///
  /// In en, this message translates to:
  /// **'Online classes'**
  String get oclOnlineClasses;

  /// No description provided for @oclNoClassScheduled.
  ///
  /// In en, this message translates to:
  /// **'No online class is scheduled for {name}\'s section. You will get a notification when the teacher schedules one.'**
  String oclNoClassScheduled(String name);

  /// No description provided for @oclComingUp.
  ///
  /// In en, this message translates to:
  /// **'Coming up'**
  String get oclComingUp;

  /// No description provided for @oclEarlier.
  ///
  /// In en, this message translates to:
  /// **'Earlier'**
  String get oclEarlier;

  /// No description provided for @oclJoinButtonNote.
  ///
  /// In en, this message translates to:
  /// **'The Join button works from 10 minutes before the class. It opens Google Meet or the app the teacher chose.'**
  String get oclJoinButtonNote;

  /// No description provided for @oclToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get oclToday;

  /// No description provided for @oclTomorrow.
  ///
  /// In en, this message translates to:
  /// **'Tomorrow'**
  String get oclTomorrow;

  /// No description provided for @oclLive.
  ///
  /// In en, this message translates to:
  /// **'LIVE'**
  String get oclLive;

  /// No description provided for @oclStarting.
  ///
  /// In en, this message translates to:
  /// **'Starting'**
  String get oclStarting;

  /// No description provided for @oclCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get oclCancelled;

  /// No description provided for @oclJoined.
  ///
  /// In en, this message translates to:
  /// **'Joined'**
  String get oclJoined;

  /// No description provided for @oclMissed.
  ///
  /// In en, this message translates to:
  /// **'Missed'**
  String get oclMissed;

  /// No description provided for @oclJoinNow.
  ///
  /// In en, this message translates to:
  /// **'Join now'**
  String get oclJoinNow;

  /// No description provided for @oclJoin.
  ///
  /// In en, this message translates to:
  /// **'Join'**
  String get oclJoin;

  /// No description provided for @oclOpensAt.
  ///
  /// In en, this message translates to:
  /// **'Opens at {time}'**
  String oclOpensAt(String time);

  /// No description provided for @oclTeacherQuestionsAndMyAnswers.
  ///
  /// In en, this message translates to:
  /// **'Teacher\'s questions & my answers'**
  String get oclTeacherQuestionsAndMyAnswers;

  /// No description provided for @oclTakeAPhotoOfTheCopy.
  ///
  /// In en, this message translates to:
  /// **'Take a photo of the copy'**
  String get oclTakeAPhotoOfTheCopy;

  /// No description provided for @oclQuestionsFromTheTeacher.
  ///
  /// In en, this message translates to:
  /// **'Questions from the teacher'**
  String get oclQuestionsFromTheTeacher;

  /// No description provided for @oclNoQuestionYet.
  ///
  /// In en, this message translates to:
  /// **'The teacher has not asked a question yet. Pull down to refresh.'**
  String get oclNoQuestionYet;

  /// No description provided for @oclWriteAnswerInCopyNote.
  ///
  /// In en, this message translates to:
  /// **'Write the answer in the copy, then send a clear photo. You can send again until the teacher closes the question.'**
  String get oclWriteAnswerInCopyNote;

  /// No description provided for @oclVerdictCorrect.
  ///
  /// In en, this message translates to:
  /// **'Correct ✓'**
  String get oclVerdictCorrect;

  /// No description provided for @oclVerdictWrong.
  ///
  /// In en, this message translates to:
  /// **'Not correct — try again'**
  String get oclVerdictWrong;

  /// No description provided for @oclVerdictPartly.
  ///
  /// In en, this message translates to:
  /// **'Partly right'**
  String get oclVerdictPartly;

  /// No description provided for @oclSentWaitingForTeacher.
  ///
  /// In en, this message translates to:
  /// **'Sent · waiting for the teacher'**
  String get oclSentWaitingForTeacher;

  /// No description provided for @oclQuestionNumber.
  ///
  /// In en, this message translates to:
  /// **'Question {number}'**
  String oclQuestionNumber(String number);

  /// No description provided for @oclQuestionNumberClosed.
  ///
  /// In en, this message translates to:
  /// **'Question {number} · closed'**
  String oclQuestionNumberClosed(String number);

  /// No description provided for @oclSending.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get oclSending;

  /// No description provided for @oclSendAgain.
  ///
  /// In en, this message translates to:
  /// **'Send again'**
  String get oclSendAgain;

  /// No description provided for @oclSendAnswerPhoto.
  ///
  /// In en, this message translates to:
  /// **'Send answer photo'**
  String get oclSendAnswerPhoto;

  /// No description provided for @tutLibrary.
  ///
  /// In en, this message translates to:
  /// **'Library'**
  String get tutLibrary;

  /// No description provided for @tutEBooks.
  ///
  /// In en, this message translates to:
  /// **'E-books'**
  String get tutEBooks;

  /// No description provided for @tutGeneralSubject.
  ///
  /// In en, this message translates to:
  /// **'General'**
  String get tutGeneralSubject;

  /// No description provided for @tutShelfKey.
  ///
  /// In en, this message translates to:
  /// **'Shelf key'**
  String get tutShelfKey;

  /// No description provided for @tutBookClasses.
  ///
  /// In en, this message translates to:
  /// **'Class {classes}'**
  String tutBookClasses(String classes);

  /// No description provided for @tutKey.
  ///
  /// In en, this message translates to:
  /// **'Key'**
  String get tutKey;

  /// No description provided for @tutKeyLine.
  ///
  /// In en, this message translates to:
  /// **'{label}: {value}'**
  String tutKeyLine(String label, String value);

  /// No description provided for @tutKeyCopied.
  ///
  /// In en, this message translates to:
  /// **'{label} copied'**
  String tutKeyCopied(String label);

  /// No description provided for @tutPromptHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. How do I explain fractions?'**
  String get tutPromptHint;

  /// No description provided for @tutPromptTeach.
  ///
  /// In en, this message translates to:
  /// **'e.g. Teach photosynthesis for Class V'**
  String get tutPromptTeach;

  /// No description provided for @tutPromptExamples.
  ///
  /// In en, this message translates to:
  /// **'e.g. Three solved examples of long division'**
  String get tutPromptExamples;

  /// No description provided for @tutPromptPractice.
  ///
  /// In en, this message translates to:
  /// **'e.g. 5 questions on tenses for Class IV'**
  String get tutPromptPractice;

  /// No description provided for @tutPromptScore.
  ///
  /// In en, this message translates to:
  /// **'Paste the questions and your child\'s answers'**
  String get tutPromptScore;

  /// No description provided for @tutPromptHomework.
  ///
  /// In en, this message translates to:
  /// **'e.g. Help with today\'s maths homework'**
  String get tutPromptHomework;

  /// No description provided for @tutPromptExam.
  ///
  /// In en, this message translates to:
  /// **'e.g. Prepare for the Class III EVS unit test'**
  String get tutPromptExam;

  /// No description provided for @tutAskTheTutor.
  ///
  /// In en, this message translates to:
  /// **'Ask the tutor…'**
  String get tutAskTheTutor;

  /// No description provided for @tutModeNeedsPassReason.
  ///
  /// In en, this message translates to:
  /// **'{mode} is part of the full tutor. Get a pass for {name} — a day, a week or a month — to unlock it.'**
  String tutModeNeedsPassReason(String mode, String name);

  /// No description provided for @tutCouldNotReachTheTutor.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the tutor. Check your connection.'**
  String get tutCouldNotReachTheTutor;

  /// No description provided for @tutReportTitle.
  ///
  /// In en, this message translates to:
  /// **'Report this reply'**
  String get tutReportTitle;

  /// No description provided for @tutReportBody.
  ///
  /// In en, this message translates to:
  /// **'The school will read this. Tell us what was wrong.'**
  String get tutReportBody;

  /// No description provided for @tutReportWrong.
  ///
  /// In en, this message translates to:
  /// **'The answer is wrong'**
  String get tutReportWrong;

  /// No description provided for @tutReportInappropriate.
  ///
  /// In en, this message translates to:
  /// **'Inappropriate or unsafe'**
  String get tutReportInappropriate;

  /// No description provided for @tutReportConfusing.
  ///
  /// In en, this message translates to:
  /// **'Confusing'**
  String get tutReportConfusing;

  /// No description provided for @tutReportOther.
  ///
  /// In en, this message translates to:
  /// **'Something else'**
  String get tutReportOther;

  /// No description provided for @tutReportNote.
  ///
  /// In en, this message translates to:
  /// **'Anything to add (optional)'**
  String get tutReportNote;

  /// No description provided for @tutReportThanks.
  ///
  /// In en, this message translates to:
  /// **'Thank you — the school will look at this.'**
  String get tutReportThanks;

  /// No description provided for @tutCouldNotSendReport.
  ///
  /// In en, this message translates to:
  /// **'Could not send the report. Please try again.'**
  String get tutCouldNotSendReport;

  /// No description provided for @tutGetAPass.
  ///
  /// In en, this message translates to:
  /// **'Get a pass'**
  String get tutGetAPass;

  /// No description provided for @tutReplyLanguage.
  ///
  /// In en, this message translates to:
  /// **'Reply language'**
  String get tutReplyLanguage;

  /// No description provided for @tutFullTutorOn.
  ///
  /// In en, this message translates to:
  /// **'Full tutor on for {name} · {valid}'**
  String tutFullTutorOn(String name, String valid);

  /// No description provided for @tutFullTutorOnLimitReached.
  ///
  /// In en, this message translates to:
  /// **'Full tutor on for {name} · {valid} · today\'s limit reached'**
  String tutFullTutorOnLimitReached(String name, String valid);

  /// No description provided for @tutModeNeedsPass.
  ///
  /// In en, this message translates to:
  /// **'{mode} needs a pass — hints stay free'**
  String tutModeNeedsPass(String mode);

  /// No description provided for @tutFreeHintsLeft.
  ///
  /// In en, this message translates to:
  /// **'{left} of {total} free hints left today'**
  String tutFreeHintsLeft(String left, String total);

  /// No description provided for @tutTutor.
  ///
  /// In en, this message translates to:
  /// **'Tutor'**
  String get tutTutor;

  /// No description provided for @tutFreeHint.
  ///
  /// In en, this message translates to:
  /// **'Free hint'**
  String get tutFreeHint;

  /// No description provided for @tutFullTutor.
  ///
  /// In en, this message translates to:
  /// **'Full tutor'**
  String get tutFullTutor;

  /// No description provided for @tutWatchVideos.
  ///
  /// In en, this message translates to:
  /// **'Watch videos'**
  String get tutWatchVideos;

  /// No description provided for @tutReported.
  ///
  /// In en, this message translates to:
  /// **'Reported'**
  String get tutReported;

  /// No description provided for @tutReport.
  ///
  /// In en, this message translates to:
  /// **'Report'**
  String get tutReport;

  /// No description provided for @tutStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get tutStop;

  /// No description provided for @tutSpeakYourQuestion.
  ///
  /// In en, this message translates to:
  /// **'Speak your question'**
  String get tutSpeakYourQuestion;

  /// No description provided for @tutListeningSpeakNow.
  ///
  /// In en, this message translates to:
  /// **'Listening… speak now'**
  String get tutListeningSpeakNow;

  /// No description provided for @tutStillAskingGooglePlay.
  ///
  /// In en, this message translates to:
  /// **'Still asking Google Play about the passes. Try again in a moment.'**
  String get tutStillAskingGooglePlay;

  /// No description provided for @tutGooglePlayCouldNotStart.
  ///
  /// In en, this message translates to:
  /// **'Google Play could not start the payment.'**
  String get tutGooglePlayCouldNotStart;

  /// No description provided for @tutCouldNotOpenPaymentPage.
  ///
  /// In en, this message translates to:
  /// **'Could not open the payment page'**
  String get tutCouldNotOpenPaymentPage;

  /// No description provided for @tutNoBrowserForPaymentPage.
  ///
  /// In en, this message translates to:
  /// **'No browser available to open the payment page'**
  String get tutNoBrowserForPaymentPage;

  /// No description provided for @tutPassFor.
  ///
  /// In en, this message translates to:
  /// **'Tutor pass for {name}'**
  String tutPassFor(String name);

  /// No description provided for @tutUnlockFullTutor.
  ///
  /// In en, this message translates to:
  /// **'Unlock the full tutor for {name} — teaching, worked examples, practice questions, answer checking, homework help and exam preparation, all at the {classLabel} level.'**
  String tutUnlockFullTutor(String name, String classLabel);

  /// No description provided for @tutCurrentPassWithPlan.
  ///
  /// In en, this message translates to:
  /// **'{plan} pass · {valid}. A new pass starts when this one ends.'**
  String tutCurrentPassWithPlan(String plan, String valid);

  /// No description provided for @tutCurrentPass.
  ///
  /// In en, this message translates to:
  /// **'{valid}. A new pass starts when this one ends.'**
  String tutCurrentPass(String valid);

  /// No description provided for @tutPendingPass.
  ///
  /// In en, this message translates to:
  /// **'{days}-day pass ({amount})'**
  String tutPendingPass(String days, String amount);

  /// No description provided for @tutWaitingForBank.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the bank: {passes}. The pass switches on by itself once the payment is confirmed.'**
  String tutWaitingForBank(String passes);

  /// No description provided for @tutPassTerms.
  ///
  /// In en, this message translates to:
  /// **'A pass is for one child and covers {name}\'s class ({classLabel}) only — a brother or sister needs their own pass. Fair use: up to 60 tutor messages a day. Hints stay free every day.'**
  String tutPassTerms(String name, String classLabel);

  /// No description provided for @tutFullTutorForOneDay.
  ///
  /// In en, this message translates to:
  /// **'Full tutor for one day'**
  String get tutFullTutorForOneDay;

  /// No description provided for @tutFullTutorForDays.
  ///
  /// In en, this message translates to:
  /// **'Full tutor for {days} days'**
  String tutFullTutorForDays(String days);

  /// No description provided for @tutVideosAllDiksha.
  ///
  /// In en, this message translates to:
  /// **'These are from DIKSHA, the Government of India\'s platform for NCERT and CBSE lessons.'**
  String get tutVideosAllDiksha;

  /// No description provided for @tutVideosSomeDiksha.
  ///
  /// In en, this message translates to:
  /// **'Videos marked DIKSHA are from the Government of India\'s lesson platform; the rest are from YouTube, not the school — judge them as you watch.'**
  String get tutVideosSomeDiksha;

  /// No description provided for @tutVideosFromYoutube.
  ///
  /// In en, this message translates to:
  /// **'Videos are from YouTube, not the school — judge them as you watch.'**
  String get tutVideosFromYoutube;

  /// No description provided for @tutVideosOnThisTopic.
  ///
  /// In en, this message translates to:
  /// **'Videos on this topic'**
  String get tutVideosOnThisTopic;

  /// No description provided for @tutNoVideosFound.
  ///
  /// In en, this message translates to:
  /// **'No videos found yet — search YouTube instead.'**
  String get tutNoVideosFound;

  /// No description provided for @tutSearchOnYoutube.
  ///
  /// In en, this message translates to:
  /// **'Search on YouTube'**
  String get tutSearchOnYoutube;

  /// No description provided for @tutGuideStep1Title.
  ///
  /// In en, this message translates to:
  /// **'1. Today\'s lesson (10 min)'**
  String get tutGuideStep1Title;

  /// No description provided for @tutGuideStep1Body.
  ///
  /// In en, this message translates to:
  /// **'Choose \"Teach a topic\" and type what was taught in school today, e.g. \"fractions\". The tutor gives a short lesson at {name}\'s class level.'**
  String tutGuideStep1Body(String name);

  /// No description provided for @tutGuideStep2Title.
  ///
  /// In en, this message translates to:
  /// **'2. Worked examples (5 min)'**
  String get tutGuideStep2Title;

  /// No description provided for @tutGuideStep2Body.
  ///
  /// In en, this message translates to:
  /// **'In \"Worked examples\", type the same topic. Every step is shown — read them with {name}.'**
  String tutGuideStep2Body(String name);

  /// No description provided for @tutGuideStep3Title.
  ///
  /// In en, this message translates to:
  /// **'3. Practice (10 min)'**
  String get tutGuideStep3Title;

  /// No description provided for @tutGuideStep3Body.
  ///
  /// In en, this message translates to:
  /// **'\"Practice questions\" gives 5 questions. {name} solves them in a notebook — answers stay hidden until you ask.'**
  String tutGuideStep3Body(String name);

  /// No description provided for @tutGuideStep4Title.
  ///
  /// In en, this message translates to:
  /// **'4. Check answers (5 min)'**
  String get tutGuideStep4Title;

  /// No description provided for @tutGuideStep4Body.
  ///
  /// In en, this message translates to:
  /// **'In \"Check answers\", type the questions with {name}\'s answers. You get marks and what to fix.'**
  String tutGuideStep4Body(String name);

  /// No description provided for @tutGuideStep5Title.
  ///
  /// In en, this message translates to:
  /// **'5. Homework'**
  String get tutGuideStep5Title;

  /// No description provided for @tutGuideStep5Body.
  ///
  /// In en, this message translates to:
  /// **'On the Homework screen, tap \"Ask tutor\" next to any item — that assignment is already in front of the tutor.'**
  String get tutGuideStep5Body;

  /// No description provided for @tutGuideStep6Title.
  ///
  /// In en, this message translates to:
  /// **'6. Before a test'**
  String get tutGuideStep6Title;

  /// No description provided for @tutGuideStep6Body.
  ///
  /// In en, this message translates to:
  /// **'In \"Exam preparation\", type the subject and date — you get a revision list, a day-wise plan and likely questions.'**
  String get tutGuideStep6Body;

  /// No description provided for @tutGuideStep7Title.
  ///
  /// In en, this message translates to:
  /// **'7. Stuck? Watch a video'**
  String get tutGuideStep7Title;

  /// No description provided for @tutGuideStep7Body.
  ///
  /// In en, this message translates to:
  /// **'Under every reply, \"Watch videos\" finds videos on that topic and plays them inside the app.'**
  String get tutGuideStep7Body;

  /// No description provided for @tutGuideFreeHintsTitle.
  ///
  /// In en, this message translates to:
  /// **'Free hints'**
  String get tutGuideFreeHintsTitle;

  /// No description provided for @tutGuideFreeHintsBody.
  ///
  /// In en, this message translates to:
  /// **'\"Hints\" are free, 20 a day — when {name} is stuck, ask for the next step. The full tutor opens with a pass: a day, a week or a month, for one child.'**
  String tutGuideFreeHintsBody(String name);

  /// No description provided for @tutGuideHeading.
  ///
  /// In en, this message translates to:
  /// **'No tuition needed — 30 minutes a day with the tutor'**
  String get tutGuideHeading;

  /// No description provided for @tutGuideIntro.
  ///
  /// In en, this message translates to:
  /// **'Sit with {name} and follow this routine every day. The tutor teaches at {name}\'s class level (CBSE), in Hindi or English.'**
  String tutGuideIntro(String name);

  /// No description provided for @tutGuideGotIt.
  ///
  /// In en, this message translates to:
  /// **'Got it, let\'s start'**
  String get tutGuideGotIt;

  /// No description provided for @authCouldNotReachServerTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the school server. Try again.'**
  String get authCouldNotReachServerTryAgain;

  /// No description provided for @authOtpSentOnWhatsappTo.
  ///
  /// In en, this message translates to:
  /// **'OTP sent on WhatsApp to {mobile}'**
  String authOtpSentOnWhatsappTo(String mobile);

  /// No description provided for @authSignInWithPasswordInstead.
  ///
  /// In en, this message translates to:
  /// **'Sign in with password instead'**
  String get authSignInWithPasswordInstead;

  /// No description provided for @authSignInWithOtpInstead.
  ///
  /// In en, this message translates to:
  /// **'Sign in with OTP instead'**
  String get authSignInWithOtpInstead;

  /// No description provided for @authSentTo.
  ///
  /// In en, this message translates to:
  /// **'Sent to {mobile}'**
  String authSentTo(String mobile);

  /// No description provided for @authIfParentChooseParentAbove.
  ///
  /// In en, this message translates to:
  /// **'If you are a parent, choose Parent above.'**
  String get authIfParentChooseParentAbove;

  /// No description provided for @authSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get authSignIn;

  /// No description provided for @authVerifyAndSignIn.
  ///
  /// In en, this message translates to:
  /// **'Verify & sign in'**
  String get authVerifyAndSignIn;

  /// No description provided for @authSendOtp.
  ///
  /// In en, this message translates to:
  /// **'Send OTP'**
  String get authSendOtp;

  /// No description provided for @homeWrongAppStaffSignIn.
  ///
  /// In en, this message translates to:
  /// **'That\'s a staff sign-in'**
  String get homeWrongAppStaffSignIn;

  /// No description provided for @homeWrongAppParentSignIn.
  ///
  /// In en, this message translates to:
  /// **'That\'s a parent sign-in'**
  String get homeWrongAppParentSignIn;

  /// No description provided for @homeWrongAppInstallOther.
  ///
  /// In en, this message translates to:
  /// **'This is the {thisApp} app. Install {otherApp} and sign in there instead.'**
  String homeWrongAppInstallOther(String thisApp, String otherApp);

  /// No description provided for @homeGuardianName.
  ///
  /// In en, this message translates to:
  /// **'Guardian: {name}'**
  String homeGuardianName(String name);

  /// No description provided for @homeNothingHereYet.
  ///
  /// In en, this message translates to:
  /// **'Nothing here yet.'**
  String get homeNothingHereYet;

  /// No description provided for @homeCouldNotReachServerCheckConnection.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the school server. Check your connection and try again.'**
  String get homeCouldNotReachServerCheckConnection;

  /// No description provided for @homeModuleComingSoon.
  ///
  /// In en, this message translates to:
  /// **'{module} is coming soon'**
  String homeModuleComingSoon(String module);

  /// No description provided for @homeNoticesAndNews.
  ///
  /// In en, this message translates to:
  /// **'Notices & news'**
  String get homeNoticesAndNews;

  /// No description provided for @homeNews.
  ///
  /// In en, this message translates to:
  /// **'News'**
  String get homeNews;

  /// No description provided for @homeNotice.
  ///
  /// In en, this message translates to:
  /// **'Notice'**
  String get homeNotice;

  /// No description provided for @homeSchoolPhotos.
  ///
  /// In en, this message translates to:
  /// **'School photos'**
  String get homeSchoolPhotos;

  /// No description provided for @homePhotoCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 photo} other{{count} photos}}'**
  String homePhotoCount(int count);

  /// No description provided for @homeModuleFees.
  ///
  /// In en, this message translates to:
  /// **'Fees'**
  String get homeModuleFees;

  /// No description provided for @homeModuleAttendance.
  ///
  /// In en, this message translates to:
  /// **'Attendance'**
  String get homeModuleAttendance;

  /// No description provided for @homeModuleHomework.
  ///
  /// In en, this message translates to:
  /// **'Homework'**
  String get homeModuleHomework;

  /// No description provided for @homeModuleTutor.
  ///
  /// In en, this message translates to:
  /// **'Tutor'**
  String get homeModuleTutor;

  /// No description provided for @homeModuleOnlineClass.
  ///
  /// In en, this message translates to:
  /// **'Online class'**
  String get homeModuleOnlineClass;

  /// No description provided for @homeModuleLibrary.
  ///
  /// In en, this message translates to:
  /// **'Library'**
  String get homeModuleLibrary;

  /// No description provided for @homeModulePtm.
  ///
  /// In en, this message translates to:
  /// **'PTM'**
  String get homeModulePtm;

  /// No description provided for @homeModuleLeave.
  ///
  /// In en, this message translates to:
  /// **'Leave'**
  String get homeModuleLeave;

  /// No description provided for @homeModuleComplaints.
  ///
  /// In en, this message translates to:
  /// **'Complaints'**
  String get homeModuleComplaints;

  /// No description provided for @homeModuleReceipts.
  ///
  /// In en, this message translates to:
  /// **'Receipts'**
  String get homeModuleReceipts;

  /// No description provided for @homeGoodMorning.
  ///
  /// In en, this message translates to:
  /// **'Good morning'**
  String get homeGoodMorning;

  /// No description provided for @homeGoodAfternoon.
  ///
  /// In en, this message translates to:
  /// **'Good afternoon'**
  String get homeGoodAfternoon;

  /// No description provided for @homeGoodEvening.
  ///
  /// In en, this message translates to:
  /// **'Good evening'**
  String get homeGoodEvening;

  /// No description provided for @homeCouldNotOpenWhatsappNumberIs.
  ///
  /// In en, this message translates to:
  /// **'Could not open WhatsApp. The school\'s number is {number}.'**
  String homeCouldNotOpenWhatsappNumberIs(String number);

  /// No description provided for @homeQuickAccess.
  ///
  /// In en, this message translates to:
  /// **'Quick access'**
  String get homeQuickAccess;

  /// No description provided for @homeSchool.
  ///
  /// In en, this message translates to:
  /// **'School'**
  String get homeSchool;

  /// No description provided for @homeMessageATeacherHours.
  ///
  /// In en, this message translates to:
  /// **'Message a teacher · 8 AM – 8 PM'**
  String get homeMessageATeacherHours;

  /// No description provided for @homeMessageATeacherSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Class and subject teachers, in app or on WhatsApp through the school'**
  String get homeMessageATeacherSubtitle;

  /// No description provided for @homeStudentIdWithNumber.
  ///
  /// In en, this message translates to:
  /// **'Student ID · {admissionNo}'**
  String homeStudentIdWithNumber(String admissionNo);

  /// No description provided for @homeGuardianTapForIdQr.
  ///
  /// In en, this message translates to:
  /// **'Guardian {name} · tap for the ID QR'**
  String homeGuardianTapForIdQr(String name);

  /// No description provided for @homeTabHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get homeTabHome;

  /// No description provided for @homeTabMessages.
  ///
  /// In en, this message translates to:
  /// **'Messages'**
  String get homeTabMessages;

  /// No description provided for @homeTabProfile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get homeTabProfile;

  /// No description provided for @homeFeesDue.
  ///
  /// In en, this message translates to:
  /// **'Fees due'**
  String get homeFeesDue;

  /// No description provided for @homeWhatsappCardSubtitle.
  ///
  /// In en, this message translates to:
  /// **'{number} · dues, receipts, pay by UPI, or ask for a person. Message from the mobile registered with the school.'**
  String homeWhatsappCardSubtitle(String number);

  /// No description provided for @apiChildClass.
  ///
  /// In en, this message translates to:
  /// **'Class {className}'**
  String apiChildClass(String className);

  /// No description provided for @apiChildClassRoll.
  ///
  /// In en, this message translates to:
  /// **'Class {className} · Roll {rollNo}'**
  String apiChildClassRoll(String className, String rollNo);

  /// No description provided for @apiFieldAdmissionNo.
  ///
  /// In en, this message translates to:
  /// **'Admission no.'**
  String get apiFieldAdmissionNo;

  /// No description provided for @apiFieldRollNo.
  ///
  /// In en, this message translates to:
  /// **'Roll no.'**
  String get apiFieldRollNo;

  /// No description provided for @apiFieldDateOfBirth.
  ///
  /// In en, this message translates to:
  /// **'Date of birth'**
  String get apiFieldDateOfBirth;

  /// No description provided for @apiGenderMale.
  ///
  /// In en, this message translates to:
  /// **'Male'**
  String get apiGenderMale;

  /// No description provided for @apiGenderFemale.
  ///
  /// In en, this message translates to:
  /// **'Female'**
  String get apiGenderFemale;

  /// No description provided for @apiGenderOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get apiGenderOther;

  /// No description provided for @apiFieldBloodGroup.
  ///
  /// In en, this message translates to:
  /// **'Blood group'**
  String get apiFieldBloodGroup;

  /// No description provided for @apiFieldCategory.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get apiFieldCategory;

  /// No description provided for @apiFieldReligion.
  ///
  /// In en, this message translates to:
  /// **'Religion'**
  String get apiFieldReligion;

  /// No description provided for @apiFieldNationality.
  ///
  /// In en, this message translates to:
  /// **'Nationality'**
  String get apiFieldNationality;

  /// No description provided for @apiFieldMotherTongue.
  ///
  /// In en, this message translates to:
  /// **'Mother tongue'**
  String get apiFieldMotherTongue;

  /// No description provided for @apiFieldPlaceOfBirth.
  ///
  /// In en, this message translates to:
  /// **'Place of birth'**
  String get apiFieldPlaceOfBirth;

  /// No description provided for @apiFieldFatherName.
  ///
  /// In en, this message translates to:
  /// **'Father\'s name'**
  String get apiFieldFatherName;

  /// No description provided for @apiFieldFatherMobile.
  ///
  /// In en, this message translates to:
  /// **'Father\'s mobile'**
  String get apiFieldFatherMobile;

  /// No description provided for @apiFieldMotherName.
  ///
  /// In en, this message translates to:
  /// **'Mother\'s name'**
  String get apiFieldMotherName;

  /// No description provided for @apiFieldMotherMobile.
  ///
  /// In en, this message translates to:
  /// **'Mother\'s mobile'**
  String get apiFieldMotherMobile;

  /// No description provided for @apiFieldEmergencyContact.
  ///
  /// In en, this message translates to:
  /// **'Emergency contact'**
  String get apiFieldEmergencyContact;

  /// No description provided for @apiFieldAadhaar.
  ///
  /// In en, this message translates to:
  /// **'Aadhaar'**
  String get apiFieldAadhaar;

  /// No description provided for @apiFieldPreviousSchool.
  ///
  /// In en, this message translates to:
  /// **'Previous school'**
  String get apiFieldPreviousSchool;

  /// No description provided for @apiFieldJoinedOn.
  ///
  /// In en, this message translates to:
  /// **'Joined on'**
  String get apiFieldJoinedOn;

  /// No description provided for @apiFieldAcademicYear.
  ///
  /// In en, this message translates to:
  /// **'Academic year'**
  String get apiFieldAcademicYear;

  /// No description provided for @apiDocSubmittedForVerification.
  ///
  /// In en, this message translates to:
  /// **'Submitted for verification.'**
  String get apiDocSubmittedForVerification;

  /// No description provided for @apiRequestFailed.
  ///
  /// In en, this message translates to:
  /// **'Request failed ({statusCode})'**
  String apiRequestFailed(String statusCode);

  /// No description provided for @apiYourWhatsapp.
  ///
  /// In en, this message translates to:
  /// **'your WhatsApp'**
  String get apiYourWhatsapp;

  /// No description provided for @apiStaffLoginNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'Staff login is not configured in this build (missing Supabase keys).'**
  String get apiStaffLoginNotConfigured;

  /// No description provided for @apiEmailOrPasswordIncorrect.
  ///
  /// In en, this message translates to:
  /// **'Email or password is incorrect.'**
  String get apiEmailOrPasswordIncorrect;

  /// No description provided for @apiSignInFailedTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Sign-in failed. Try again.'**
  String get apiSignInFailedTryAgain;

  /// No description provided for @apiTutorUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Tutor unavailable ({statusCode})'**
  String apiTutorUnavailable(String statusCode);

  /// No description provided for @apiTutorFailed.
  ///
  /// In en, this message translates to:
  /// **'Tutor failed'**
  String get apiTutorFailed;

  /// No description provided for @apiSchoolWhatsappCouldNotSend.
  ///
  /// In en, this message translates to:
  /// **'The school\'s WhatsApp could not send this'**
  String get apiSchoolWhatsappCouldNotSend;

  /// No description provided for @apiCouldNotStartPayment.
  ///
  /// In en, this message translates to:
  /// **'Could not start payment'**
  String get apiCouldNotStartPayment;

  /// No description provided for @apiThisChild.
  ///
  /// In en, this message translates to:
  /// **'this child'**
  String get apiThisChild;

  /// No description provided for @apiValidTill.
  ///
  /// In en, this message translates to:
  /// **'Valid till {date}'**
  String apiValidTill(String date);

  /// No description provided for @apiOnlineClass.
  ///
  /// In en, this message translates to:
  /// **'Online class'**
  String get apiOnlineClass;

  /// No description provided for @apiOnlineRegisterMarked.
  ///
  /// In en, this message translates to:
  /// **'{present} present of {total}'**
  String apiOnlineRegisterMarked(String present, String total);

  /// No description provided for @apiOnlineRegisterMarkedWithAlerts.
  ///
  /// In en, this message translates to:
  /// **'{present} present of {total} · {alerts} absent alerts sent'**
  String apiOnlineRegisterMarkedWithAlerts(
    String present,
    String total,
    String alerts,
  );

  /// No description provided for @apiOnlineRoomMatched.
  ///
  /// In en, this message translates to:
  /// **'{inRoom} in the room, {matched} matched'**
  String apiOnlineRoomMatched(String inRoom, String matched);

  /// No description provided for @apiOnlineRoomMatchedWithUnmatched.
  ///
  /// In en, this message translates to:
  /// **'{inRoom} in the room, {matched} matched · not matched: {names}'**
  String apiOnlineRoomMatchedWithUnmatched(
    String inRoom,
    String matched,
    String names,
  );

  /// No description provided for @sysPlayUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Google Play is not available on this phone. The app must be installed from Play, with a Google account signed in.'**
  String get sysPlayUnavailable;

  /// No description provided for @sysPlayReturnedError.
  ///
  /// In en, this message translates to:
  /// **'Google Play returned an error: {error}'**
  String sysPlayReturnedError(String error);

  /// No description provided for @sysPlayPassesNotFound.
  ///
  /// In en, this message translates to:
  /// **'Google Play does not have these passes yet: {ids}. They may still be publishing.'**
  String sysPlayPassesNotFound(String ids);

  /// No description provided for @sysPlayNoPasses.
  ///
  /// In en, this message translates to:
  /// **'Google Play has no passes to sell right now.'**
  String get sysPlayNoPasses;

  /// No description provided for @sysPlayPaymentDidNotGoThrough.
  ///
  /// In en, this message translates to:
  /// **'The payment did not go through'**
  String get sysPlayPaymentDidNotGoThrough;

  /// No description provided for @sysCouldNotReachSchoolServer.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the school server'**
  String get sysCouldNotReachSchoolServer;

  /// No description provided for @sysPushChannelName.
  ///
  /// In en, this message translates to:
  /// **'School updates'**
  String get sysPushChannelName;

  /// No description provided for @sysPushChannelDescription.
  ///
  /// In en, this message translates to:
  /// **'Homework, attendance, messages from the class teacher, fee receipts and notices.'**
  String get sysPushChannelDescription;

  /// No description provided for @profGuardian.
  ///
  /// In en, this message translates to:
  /// **'Guardian'**
  String get profGuardian;

  /// No description provided for @profRegisteredMobile.
  ///
  /// In en, this message translates to:
  /// **'Registered mobile'**
  String get profRegisteredMobile;

  /// No description provided for @profAlternateMobile.
  ///
  /// In en, this message translates to:
  /// **'Alternate mobile'**
  String get profAlternateMobile;

  /// No description provided for @profEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get profEmail;

  /// No description provided for @profAddress.
  ///
  /// In en, this message translates to:
  /// **'Address'**
  String get profAddress;

  /// No description provided for @profLocality.
  ///
  /// In en, this message translates to:
  /// **'Locality'**
  String get profLocality;

  /// No description provided for @profCity.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get profCity;

  /// No description provided for @profState.
  ///
  /// In en, this message translates to:
  /// **'State'**
  String get profState;

  /// No description provided for @profPinCode.
  ///
  /// In en, this message translates to:
  /// **'PIN code'**
  String get profPinCode;

  /// No description provided for @profProfile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profProfile;

  /// No description provided for @profFamily.
  ///
  /// In en, this message translates to:
  /// **'Family'**
  String get profFamily;

  /// No description provided for @profChildren.
  ///
  /// In en, this message translates to:
  /// **'Children'**
  String get profChildren;

  /// No description provided for @profClassAdmNo.
  ///
  /// In en, this message translates to:
  /// **'{classLabel} · Adm. {admissionNo}'**
  String profClassAdmNo(String classLabel, String admissionNo);

  /// No description provided for @profDocsStatusAllIn.
  ///
  /// In en, this message translates to:
  /// **'All required documents in · profile {percent}% complete'**
  String profDocsStatusAllIn(String percent);

  /// No description provided for @profDocsStatusOneMissing.
  ///
  /// In en, this message translates to:
  /// **'1 required document to upload · profile {percent}% complete'**
  String profDocsStatusOneMissing(String percent);

  /// No description provided for @profDocsStatusMissing.
  ///
  /// In en, this message translates to:
  /// **'{count} required documents to upload · profile {percent}% complete'**
  String profDocsStatusMissing(String count, String percent);

  /// No description provided for @profRegisteredMobileNote.
  ///
  /// In en, this message translates to:
  /// **'Registered mobile {mobile} is your sign-in and can only be changed at the office.'**
  String profRegisteredMobileNote(String mobile);

  /// No description provided for @profSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get profSaving;

  /// No description provided for @profStudentProfile.
  ///
  /// In en, this message translates to:
  /// **'Student profile'**
  String get profStudentProfile;

  /// No description provided for @profDocumentsSchoolNeeds.
  ///
  /// In en, this message translates to:
  /// **'Documents the school needs'**
  String get profDocumentsSchoolNeeds;

  /// No description provided for @profDetailsOnRecord.
  ///
  /// In en, this message translates to:
  /// **'Details on record'**
  String get profDetailsOnRecord;

  /// No description provided for @profDocBirthCert.
  ///
  /// In en, this message translates to:
  /// **'Birth certificate'**
  String get profDocBirthCert;

  /// No description provided for @profDocPhoto.
  ///
  /// In en, this message translates to:
  /// **'Photo'**
  String get profDocPhoto;

  /// No description provided for @profDocAadhaar.
  ///
  /// In en, this message translates to:
  /// **'Aadhaar'**
  String get profDocAadhaar;

  /// No description provided for @profDocAddressProof.
  ///
  /// In en, this message translates to:
  /// **'Address proof'**
  String get profDocAddressProof;

  /// No description provided for @profDocTc.
  ///
  /// In en, this message translates to:
  /// **'Transfer certificate'**
  String get profDocTc;

  /// No description provided for @profDocCasteCert.
  ///
  /// In en, this message translates to:
  /// **'Caste certificate'**
  String get profDocCasteCert;

  /// No description provided for @profDocIncomeCert.
  ///
  /// In en, this message translates to:
  /// **'Income certificate'**
  String get profDocIncomeCert;

  /// No description provided for @profCheckMatches.
  ///
  /// In en, this message translates to:
  /// **'{label}: matches'**
  String profCheckMatches(String label);

  /// No description provided for @profCheckMismatch.
  ///
  /// In en, this message translates to:
  /// **'{label}: does not match'**
  String profCheckMismatch(String label);

  /// No description provided for @profCheckNotReadable.
  ///
  /// In en, this message translates to:
  /// **'{label}: not readable'**
  String profCheckNotReadable(String label);

  /// No description provided for @profCheckNotOnRecord.
  ///
  /// In en, this message translates to:
  /// **'{label}: not on record'**
  String profCheckNotOnRecord(String label);

  /// No description provided for @profCouldNotUpload.
  ///
  /// In en, this message translates to:
  /// **'Could not upload'**
  String get profCouldNotUpload;

  /// No description provided for @profNotAccepted.
  ///
  /// In en, this message translates to:
  /// **'Not accepted'**
  String get profNotAccepted;

  /// No description provided for @profProfilePercentComplete.
  ///
  /// In en, this message translates to:
  /// **'Profile {percent}% complete'**
  String profProfilePercentComplete(String percent);

  /// No description provided for @profVerified.
  ///
  /// In en, this message translates to:
  /// **'Verified'**
  String get profVerified;

  /// No description provided for @profAwaitingVerification.
  ///
  /// In en, this message translates to:
  /// **'Awaiting verification'**
  String get profAwaitingVerification;

  /// No description provided for @profRejected.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get profRejected;

  /// No description provided for @profRequired.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get profRequired;

  /// No description provided for @profOptional.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get profOptional;

  /// No description provided for @profOfficeNote.
  ///
  /// In en, this message translates to:
  /// **'Office: {note}'**
  String profOfficeNote(String note);

  /// No description provided for @profUploadAgain.
  ///
  /// In en, this message translates to:
  /// **'Upload again'**
  String get profUploadAgain;

  /// No description provided for @profUpload.
  ///
  /// In en, this message translates to:
  /// **'Upload'**
  String get profUpload;

  /// No description provided for @profSchoolNote.
  ///
  /// In en, this message translates to:
  /// **'School: {note}'**
  String profSchoolNote(String note);

  /// No description provided for @profSending.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get profSending;

  /// No description provided for @profSendRequest.
  ///
  /// In en, this message translates to:
  /// **'Send request'**
  String get profSendRequest;

  /// No description provided for @profLeave.
  ///
  /// In en, this message translates to:
  /// **'Leave'**
  String get profLeave;

  /// No description provided for @profLeaveTypeOneDay.
  ///
  /// In en, this message translates to:
  /// **'{type} · 1 day'**
  String profLeaveTypeOneDay(String type);

  /// No description provided for @profLeaveTypeDays.
  ///
  /// In en, this message translates to:
  /// **'{type} · {days} days'**
  String profLeaveTypeDays(String type, String days);

  /// No description provided for @profLeaveApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get profLeaveApproved;

  /// No description provided for @profLeaveNotApproved.
  ///
  /// In en, this message translates to:
  /// **'Not approved'**
  String get profLeaveNotApproved;

  /// No description provided for @profLeaveWithdrawn.
  ///
  /// In en, this message translates to:
  /// **'Withdrawn'**
  String get profLeaveWithdrawn;

  /// No description provided for @profLeavePending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get profLeavePending;

  /// No description provided for @profLeaveForChild.
  ///
  /// In en, this message translates to:
  /// **'Leave for {name}'**
  String profLeaveForChild(String name);

  /// No description provided for @profDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get profDate;

  /// No description provided for @profFrom.
  ///
  /// In en, this message translates to:
  /// **'From'**
  String get profFrom;

  /// No description provided for @profTo.
  ///
  /// In en, this message translates to:
  /// **'To'**
  String get profTo;

  /// No description provided for @busRouteLine.
  ///
  /// In en, this message translates to:
  /// **'Bus {code} · {name}'**
  String busRouteLine(String code, String name);

  /// No description provided for @busStopLine.
  ///
  /// In en, this message translates to:
  /// **'Stop: {stop}'**
  String busStopLine(String stop);

  /// No description provided for @busMorningPickupOnly.
  ///
  /// In en, this message translates to:
  /// **'Morning pickup only'**
  String get busMorningPickupOnly;

  /// No description provided for @busAfternoonDropOnly.
  ///
  /// In en, this message translates to:
  /// **'Afternoon drop only'**
  String get busAfternoonDropOnly;

  /// No description provided for @busPickupAndDrop.
  ///
  /// In en, this message translates to:
  /// **'Pickup and drop'**
  String get busPickupAndDrop;

  /// No description provided for @busFeePerMonth.
  ///
  /// In en, this message translates to:
  /// **'{fee} per month'**
  String busFeePerMonth(String fee);

  /// No description provided for @busDriverLine.
  ///
  /// In en, this message translates to:
  /// **'Driver: {name}'**
  String busDriverLine(String name);

  /// No description provided for @busLiveBusLocation.
  ///
  /// In en, this message translates to:
  /// **'Live bus location'**
  String get busLiveBusLocation;

  /// No description provided for @busRequestSchoolTransport.
  ///
  /// In en, this message translates to:
  /// **'Request school transport'**
  String get busRequestSchoolTransport;

  /// No description provided for @busRequestAgain.
  ///
  /// In en, this message translates to:
  /// **'Request again'**
  String get busRequestAgain;

  /// No description provided for @busCouldNotStartCall.
  ///
  /// In en, this message translates to:
  /// **'Could not start a call. The number is {mobile}.'**
  String busCouldNotStartCall(String mobile);

  /// No description provided for @busStatusContacted.
  ///
  /// In en, this message translates to:
  /// **'Office has been in touch'**
  String get busStatusContacted;

  /// No description provided for @busStatusAssigned.
  ///
  /// In en, this message translates to:
  /// **'Assigned — bus details will appear here'**
  String get busStatusAssigned;

  /// No description provided for @busStatusDeclined.
  ///
  /// In en, this message translates to:
  /// **'Not possible right now'**
  String get busStatusDeclined;

  /// No description provided for @busStatusRequested.
  ///
  /// In en, this message translates to:
  /// **'Request sent — waiting for the office'**
  String get busStatusRequested;

  /// No description provided for @busTransportForChild.
  ///
  /// In en, this message translates to:
  /// **'School transport for {name}'**
  String busTransportForChild(String name);

  /// No description provided for @busNoBusAssigned.
  ///
  /// In en, this message translates to:
  /// **'No bus is assigned to {name}.'**
  String busNoBusAssigned(String name);

  /// No description provided for @busCouldNotLoadPosition.
  ///
  /// In en, this message translates to:
  /// **'Could not load the bus position. It will try again on its own, or tap refresh.'**
  String get busCouldNotLoadPosition;

  /// No description provided for @busBusLocation.
  ///
  /// In en, this message translates to:
  /// **'Bus location'**
  String get busBusLocation;

  /// No description provided for @busCentreOnBus.
  ///
  /// In en, this message translates to:
  /// **'Centre on the bus'**
  String get busCentreOnBus;

  /// No description provided for @busNoGpsTracker.
  ///
  /// In en, this message translates to:
  /// **'This vehicle has no GPS tracker'**
  String get busNoGpsTracker;

  /// No description provided for @busNoGpsTrackerDetail.
  ///
  /// In en, this message translates to:
  /// **'{vehicle} · live location is not available. Call the driver from the Transport page.'**
  String busNoGpsTrackerDetail(String vehicle);

  /// No description provided for @busNotOnTrip.
  ///
  /// In en, this message translates to:
  /// **'Bus is not on a school trip now'**
  String get busNotOnTrip;

  /// No description provided for @busLiveHoursNote.
  ///
  /// In en, this message translates to:
  /// **'Live location shows during the transport day (06:00–17:30, Mon–Sat).'**
  String get busLiveHoursNote;

  /// No description provided for @busTrackerNotReporting.
  ///
  /// In en, this message translates to:
  /// **'Tracker not reporting right now'**
  String get busTrackerNotReporting;

  /// No description provided for @busTrackerStaleNote.
  ///
  /// In en, this message translates to:
  /// **'Last position is older than 15 minutes, so it is not shown. Refreshes every 15 seconds.'**
  String get busTrackerStaleNote;

  /// No description provided for @busSecondsAgo.
  ///
  /// In en, this message translates to:
  /// **'{seconds}s ago'**
  String busSecondsAgo(String seconds);

  /// No description provided for @busMinutesAgo.
  ///
  /// In en, this message translates to:
  /// **'{minutes} min ago'**
  String busMinutesAgo(String minutes);

  /// No description provided for @busEtaToStop.
  ///
  /// In en, this message translates to:
  /// **'About {minutes} min to {stop}'**
  String busEtaToStop(String minutes, String stop);

  /// No description provided for @busEtaToYourStop.
  ///
  /// In en, this message translates to:
  /// **'About {minutes} min to your stop'**
  String busEtaToYourStop(String minutes);

  /// No description provided for @busOnTheRoad.
  ///
  /// In en, this message translates to:
  /// **'Bus is on the road'**
  String get busOnTheRoad;

  /// No description provided for @busMorningPickupPhase.
  ///
  /// In en, this message translates to:
  /// **'Morning pickup'**
  String get busMorningPickupPhase;

  /// No description provided for @busAfternoonDropPhase.
  ///
  /// In en, this message translates to:
  /// **'Afternoon drop'**
  String get busAfternoonDropPhase;

  /// No description provided for @busUpdatedAgo.
  ///
  /// In en, this message translates to:
  /// **'updated {age}'**
  String busUpdatedAgo(String age);

  /// No description provided for @busSpeedKmh.
  ///
  /// In en, this message translates to:
  /// **'{speed} km/h'**
  String busSpeedKmh(String speed);

  /// No description provided for @busKmAway.
  ///
  /// In en, this message translates to:
  /// **'{km} km away'**
  String busKmAway(String km);

  /// No description provided for @busEstimateNotPromise.
  ///
  /// In en, this message translates to:
  /// **'estimate, not a promise'**
  String get busEstimateNotPromise;

  /// No description provided for @modAttendanceTitle.
  ///
  /// In en, this message translates to:
  /// **'Attendance'**
  String get modAttendanceTitle;

  /// No description provided for @modAttendancePresent.
  ///
  /// In en, this message translates to:
  /// **'Present'**
  String get modAttendancePresent;

  /// No description provided for @modAttendanceAbsent.
  ///
  /// In en, this message translates to:
  /// **'Absent'**
  String get modAttendanceAbsent;

  /// No description provided for @modAttendanceLate.
  ///
  /// In en, this message translates to:
  /// **'Late'**
  String get modAttendanceLate;

  /// No description provided for @modFeeReceiptsTitle.
  ///
  /// In en, this message translates to:
  /// **'Fee receipts'**
  String get modFeeReceiptsTitle;

  /// No description provided for @modReceiptVoidCancelledByOffice.
  ///
  /// In en, this message translates to:
  /// **'VOID — cancelled by the office'**
  String get modReceiptVoidCancelledByOffice;

  /// No description provided for @modReceiptTitle.
  ///
  /// In en, this message translates to:
  /// **'Receipt {receiptNo}'**
  String modReceiptTitle(String receiptNo);

  /// No description provided for @modFeesTitle.
  ///
  /// In en, this message translates to:
  /// **'Fees'**
  String get modFeesTitle;

  /// No description provided for @modFeesCouldNotStartPayment.
  ///
  /// In en, this message translates to:
  /// **'Could not start payment'**
  String get modFeesCouldNotStartPayment;

  /// No description provided for @modFeesNoBrowserForPaymentPage.
  ///
  /// In en, this message translates to:
  /// **'No browser available to open the payment page'**
  String get modFeesNoBrowserForPaymentPage;

  /// No description provided for @modFeesCouldNotStartPaymentConnection.
  ///
  /// In en, this message translates to:
  /// **'Could not start payment — check your connection and try again.'**
  String get modFeesCouldNotStartPaymentConnection;

  /// No description provided for @modFeesNoBrowserForPage.
  ///
  /// In en, this message translates to:
  /// **'No browser available to open the page'**
  String get modFeesNoBrowserForPage;

  /// No description provided for @modFeesCouldNotStartAutopay.
  ///
  /// In en, this message translates to:
  /// **'Could not start auto-pay — check your connection and try again.'**
  String get modFeesCouldNotStartAutopay;

  /// No description provided for @modFeesCouldNotStopAutopay.
  ///
  /// In en, this message translates to:
  /// **'Could not stop auto-pay — check your connection and try again.'**
  String get modFeesCouldNotStopAutopay;

  /// No description provided for @modFeesDueOn.
  ///
  /// In en, this message translates to:
  /// **'Due {date}'**
  String modFeesDueOn(String date);

  /// No description provided for @modFeesFallsDueOn.
  ///
  /// In en, this message translates to:
  /// **'Falls due {date}'**
  String modFeesFallsDueOn(String date);

  /// No description provided for @modFeesSelectAFeeToPay.
  ///
  /// In en, this message translates to:
  /// **'Select a fee to pay'**
  String get modFeesSelectAFeeToPay;

  /// No description provided for @modFeesPayAmountOnline.
  ///
  /// In en, this message translates to:
  /// **'Pay {amount} online'**
  String modFeesPayAmountOnline(String amount);

  /// No description provided for @modFeesPayAhead.
  ///
  /// In en, this message translates to:
  /// **'Pay ahead · {amount} for the months to come'**
  String modFeesPayAhead(String amount);

  /// No description provided for @modPtmTitle.
  ///
  /// In en, this message translates to:
  /// **'Parent-teacher meetings'**
  String get modPtmTitle;

  /// No description provided for @modPtmForChild.
  ///
  /// In en, this message translates to:
  /// **'for {name}'**
  String modPtmForChild(String name);

  /// No description provided for @modPtmNoneScheduled.
  ///
  /// In en, this message translates to:
  /// **'No PTM scheduled for {name}\'s class right now. Booking opens here when the school announces one.'**
  String modPtmNoneScheduled(String name);

  /// No description provided for @modPtmSeatsLeft.
  ///
  /// In en, this message translates to:
  /// **'{count} left'**
  String modPtmSeatsLeft(String count);

  /// No description provided for @modPtmSlotFull.
  ///
  /// In en, this message translates to:
  /// **'Full'**
  String get modPtmSlotFull;

  /// No description provided for @modPtmSlotBooked.
  ///
  /// In en, this message translates to:
  /// **'Slot booked'**
  String get modPtmSlotBooked;

  /// No description provided for @modPtmBookedWith.
  ///
  /// In en, this message translates to:
  /// **'Booked — {teacher}, {time}'**
  String modPtmBookedWith(String teacher, String time);

  /// No description provided for @modChatClassTeacher.
  ///
  /// In en, this message translates to:
  /// **'Class teacher'**
  String get modChatClassTeacher;

  /// No description provided for @modChatClassTeacherNamed.
  ///
  /// In en, this message translates to:
  /// **'Class teacher: {name}'**
  String modChatClassTeacherNamed(String name);

  /// No description provided for @modChatNoMessagesSayHello.
  ///
  /// In en, this message translates to:
  /// **'No messages yet. Say hello to {name}.'**
  String modChatNoMessagesSayHello(String name);

  /// No description provided for @modChatNoClassTeacherAssigned.
  ///
  /// In en, this message translates to:
  /// **'No class teacher is assigned to this section yet — check with the school office.'**
  String get modChatNoClassTeacherAssigned;

  /// No description provided for @modTeachersTitle.
  ///
  /// In en, this message translates to:
  /// **'Teachers'**
  String get modTeachersTitle;

  /// No description provided for @modTeachersWhatsappNote.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp messages go to the school\'s number ({number}) and are passed to the teacher — the message is already addressed, just type below the last line and send.'**
  String modTeachersWhatsappNote(String number);

  /// No description provided for @modTeachersAvailableTill8pm.
  ///
  /// In en, this message translates to:
  /// **'Teachers are available till 8 PM'**
  String get modTeachersAvailableTill8pm;

  /// No description provided for @modTeachersAvailableHours.
  ///
  /// In en, this message translates to:
  /// **'Teachers are available {hours}'**
  String modTeachersAvailableHours(String hours);

  /// No description provided for @modTeachersClosedNote.
  ///
  /// In en, this message translates to:
  /// **'Teachers are not available right now (8 AM – 8 PM). A message sent in the app is kept safe and reaches them in the morning.'**
  String get modTeachersClosedNote;

  /// No description provided for @modTeachersAfter8am.
  ///
  /// In en, this message translates to:
  /// **'After 8 AM'**
  String get modTeachersAfter8am;

  /// No description provided for @modHomeworkTitle.
  ///
  /// In en, this message translates to:
  /// **'Homework & diary'**
  String get modHomeworkTitle;

  /// No description provided for @modHomeworkEmptyTeacher.
  ///
  /// In en, this message translates to:
  /// **'No homework posted for this section yet — use the button below to post the first one.'**
  String get modHomeworkEmptyTeacher;

  /// No description provided for @modHomeworkEmptyParent.
  ///
  /// In en, this message translates to:
  /// **'No homework posted for this class yet. New homework appears here as soon as the teacher publishes it.'**
  String get modHomeworkEmptyParent;

  /// No description provided for @modHomeworkLabel.
  ///
  /// In en, this message translates to:
  /// **'Homework'**
  String get modHomeworkLabel;

  /// No description provided for @modHomeworkDueOn.
  ///
  /// In en, this message translates to:
  /// **'due {date}'**
  String modHomeworkDueOn(String date);

  /// No description provided for @modHomeworkCouldNotPost.
  ///
  /// In en, this message translates to:
  /// **'Could not post. Check the connection and try again.'**
  String get modHomeworkCouldNotPost;

  /// No description provided for @modComplaintsTitle.
  ///
  /// In en, this message translates to:
  /// **'Complaints'**
  String get modComplaintsTitle;

  /// No description provided for @modComplaintsAboutChild.
  ///
  /// In en, this message translates to:
  /// **'about {name}'**
  String modComplaintsAboutChild(String name);

  /// No description provided for @modComplaintsSchoolResponse.
  ///
  /// In en, this message translates to:
  /// **'School\'s response: {note}'**
  String modComplaintsSchoolResponse(String note);

  /// No description provided for @modComplaintsSending.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get modComplaintsSending;

  /// No description provided for @modComplaintsSendToSchool.
  ///
  /// In en, this message translates to:
  /// **'Send to the school'**
  String get modComplaintsSendToSchool;

  /// No description provided for @modDiaryLabel.
  ///
  /// In en, this message translates to:
  /// **'Diary'**
  String get modDiaryLabel;

  /// No description provided for @homeNewCount.
  ///
  /// In en, this message translates to:
  /// **'{count} new'**
  String homeNewCount(String count);
}

class _LDelegate extends LocalizationsDelegate<L> {
  const _LDelegate();

  @override
  Future<L> load(Locale locale) {
    return SynchronousFuture<L>(lookupL(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'hi'].contains(locale.languageCode);

  @override
  bool shouldReload(_LDelegate old) => false;
}

L lookupL(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return LEn();
    case 'hi':
      return LHi();
  }

  throw FlutterError(
    'L.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
