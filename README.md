# Callisthénie Universelle — Android App

Appli callisthénie avec questionnaire de première ouverture (genre, âge, matériel disponible) qui génère un programme personnalisé, plus widget écran d'accueil.

## Compilation

### Via GitHub Actions (recommandé)
1. Push ce dossier sur GitHub
2. GitHub Actions compile automatiquement
3. Télécharger l'APK dans **Actions → Build APK → Artifacts** (ou dans Releases)

### Structure
- `app/src/main/assets/programme.html` — l'appli complète (questionnaire + moteur de génération de programme)
- `MainActivity.java` — WebView plein écran
- `ProgrammeWidget.java` — widget 4×2 écran d'accueil

## Widget
Affiche la séance du jour avec couleur dynamique. Se met à jour automatiquement toutes les 30 minutes.

## Profil utilisateur
Le profil (genre, âge, matériel) est stocké localement sur l'appareil (WebView storage) : chaque installation garde son propre programme, modifiable via l'icône ⚙ dans l'appli.
