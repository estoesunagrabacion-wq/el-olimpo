plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ar.impresora.xerox"
    compileSdk = 35

    defaultConfig {
        applicationId = "ar.impresora.xerox"
        minSdk = 28
        targetSdk = 35
        versionCode = 3
        versionName = "0.3"
    }

    // Clave fija (sólo para esta app personal): así cada versión nueva se
    // instala encima de la anterior sin tener que desinstalarla.
    signingConfigs {
        getByName("debug") {
            storeFile = file("depuracion.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
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

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":qpdl"))
}
