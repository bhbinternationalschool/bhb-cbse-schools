import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services")
}

// Release signing lives in android/key.properties (gitignored). Builds fall
// back to debug signing when it's absent so CI and other machines still work.
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasReleaseKeystore = keystoreProperties.getProperty("storeFile") != null

android {
    namespace = "school.bhbinternational.cbse_school_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // flutter_local_notifications needs java.time on older API levels.
        isCoreLibraryDesugaringEnabled = true
    }

    buildFeatures {
        // The flavours set android:label through resValue("string", "app_label").
        // AGP 8 turns generated resource values off unless asked.
        resValues = true
    }

    defaultConfig {
        // No applicationId here — each flavour sets its own. See below.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Two apps out of one codebase, split so the parent build can ship without
    // the restricted permissions the staff features need. The Dart side is
    // split to match — lib/main_parent.dart and lib/main_staff.dart — and a
    // build must name both, e.g.
    //
    //   flutter build appbundle --release --flavor parent -t lib/main_parent.dart
    //
    // Mismatching them produces an app whose manifest and code disagree.
    flavorDimensions += "audience"
    productFlavors {
        create("parent") {
            dimension = "audience"
            // A new identity: parents install this fresh from Play.
            applicationId = "school.bhbinternational.parent"
            resValue("string", "app_label", "BHB School — Parents")
        }
        create("staff") {
            dimension = "audience"
            // KEEP the original id. Staff already run this app from the APK on
            // the download page; changing it would orphan every install and
            // they would have to uninstall and re-install by hand.
            applicationId = "school.bhbinternational.cbse_school_mobile"
            resValue("string", "app_label", "BHB School — Staff")
        }
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile =
                    rootProject.file("app/${keystoreProperties.getProperty("storeFile")}")
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
