# Callisthénie — version générique (Android)

Application de callisthénie (WebView plein écran + widget écran d'accueil), sans données personnelles.
Toutes les séances sont **paramétrables directement dans l'appli**.

## Paramétrer les séances
Onglets **Programme** et **Extra** → bouton **⚙️ Paramétrer la séance** sous l'en-tête :
- séance : nom, description, horaire, durée, nombre de tours, repos de fin de tour, conseil ;
- échauffement : ajouter / modifier / supprimer des mouvements ;
- exercices : nom, répétitions, **durée de tenue** (minuteur), **poids (kg)**, repos après, note,
  technique / astuce / erreur à éviter ; ajouter, dupliquer, déplacer, supprimer ;
- **↺ Séance par défaut** pour revenir au modèle d'origine ;
- **⇄ Sauvegarde / transfert** : copier les réglages en texte et les importer sur un autre téléphone.

Les réglages sont enregistrés sur le téléphone et conservés lors des mises à jour de l'APK.
Le widget affiche automatiquement la séance du jour paramétrée.

## Autres onglets
- **Poids** : courbe vide au départ, objectif / date visée / taille (IMC) à saisir via 🎯,
  import des pesées depuis Health Connect.
- **Santé** : lecture Health Connect (pas, calories, sommeil, cœur, composition), objectifs réglables.
- **Respiration** : exercice de respiration guidée.

## Compilation
GitHub Actions compile l'APK à chaque push sur `main` :
**Actions → Build APK → Artifacts**.

- Package : `com.callisthenie.app` (s'installe à côté d'autres versions)
- Clé de signature fixe (`app/debug.keystore`) : chaque nouvel APK s'installe par-dessus le précédent sans perte de données.
