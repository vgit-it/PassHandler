plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.passhandler.plugin"
    compileSdk = 34

    defaultConfig {
        minSdk = 26

        // Shipped to whatever consumes this library — in practice the generated
        // app module, which cannot carry rules of its own because
        // `tauri android init` regenerates it.
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")

    // Keystore-backed storage. The master key is generated inside the Android
    // Keystore and never leaves it; only ciphertext reaches shared preferences.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // BiometricPrompt, with device-credential fallback on devices that have no
    // biometric hardware enrolled.
    implementation("androidx.biometric:biometric:1.1.0")

    implementation(project(":tauri-android"))
}
