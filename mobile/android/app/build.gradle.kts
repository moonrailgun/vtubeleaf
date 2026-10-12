import java.net.URI
import java.security.MessageDigest
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.moonrailgun.vtubeleaf.phone"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.moonrailgun.vtubeleaf.phone"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// Newest cohort that still builds with AGP 8.13 / compileSdk 36; later ones need AGP 9.1 and SDK 37.
dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.06.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.camera:camera-core:1.6.2")
    implementation("androidx.camera:camera-camera2:1.6.2")
    implementation("androidx.camera:camera-lifecycle:1.6.2")
    implementation("androidx.camera:camera-view:1.6.2")
    implementation("com.google.mediapipe:tasks-vision:0.10.35")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    // The real org.json for JVM unit tests; the Android SDK stub throws on every call.
    testImplementation("org.json:json:20250517")
}

// The same pinned Face Landmarker model the desktop app prepares with `npm run setup:assets`.
val faceModel = layout.projectDirectory.file("src/main/assets/face_landmarker.task")
val downloadFaceModel by tasks.registering {
    description = "Downloads the pinned MediaPipe Face Landmarker model into assets"
    outputs.file(faceModel)
    doLast {
        val expected = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
        val sha256 = { bytes: ByteArray ->
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        }
        val file = faceModel.asFile
        if (!file.exists() || sha256(file.readBytes()) != expected) {
            val url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
            val bytes = URI(url).toURL().readBytes()
            check(sha256(bytes) == expected) { "face_landmarker.task does not match the pinned SHA-256" }
            file.parentFile.mkdirs()
            file.writeBytes(bytes)
        }
    }
}
tasks.named("preBuild") { dependsOn(downloadFaceModel) }
