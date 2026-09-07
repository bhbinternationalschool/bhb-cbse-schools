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
