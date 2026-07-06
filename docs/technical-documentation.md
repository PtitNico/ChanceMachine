# ChanceMachine — Documentation technique

## Vue d'ensemble

ChanceMachine est une PWA (Progressive Web App) Angular qui calcule, par énumération exacte (pas de Monte Carlo), les probabilités de toucher/détruire une cible dans Warmachine/Hordes, pour une séquence d'attaques (plusieurs attaquants, plusieurs attaques chacun) enchaînée sur une même cible.

- **Stack** : Angular 21 (standalone components, signals), TypeScript, Vitest.
- **Aucune dépendance runtime au-delà d'Angular** : le moteur de calcul (`src/app/engine/`) est du TypeScript pur, sans dépendance Angular, testable isolément.
- **PWA** : `@angular/service-worker`, installable sur mobile (Android/iOS via "Ajouter à l'écran d'accueil"), fonctionne hors-ligne (aucun appel réseau applicatif).

## Structure du projet

```
src/
  app/
    engine/                 # Moteur de calcul, pur TypeScript, sans dépendance Angular
      dice-pool.ts           # Énumération exacte des jets de dés d6
      attack-model.ts        # Modèle d'une attaque unique (toucher + dégâts + Tough)
      sequence.ts            # Enchaînement de plusieurs attaques sur une cible partagée
      odds-engine.ts          # Wrapper @Injectable exposant le moteur aux composants
      engine.spec.ts          # Tests unitaires du moteur (Vitest)
    odds-calculator/         # Composant UI principal (formulaire + résultats)
    app.ts / app.html / app.css   # Coquille de l'application
  index.html
  main.ts
public/
  manifest.webmanifest, icons/   # Assets PWA
ngsw-config.json             # Configuration du service worker (cache des assets)
angular.json                 # Configuration du build/serve/test Angular CLI
```

## Le moteur de calcul (`src/app/engine/`)

### Principe général : énumération exacte, pas de simulation

Les jets de dés dans Warmachine/Hordes portent sur des pools de d6 petits (2 à ~8 dés avec boosts). L'espace des résultats (6^n) reste donc minuscule (6^8 ≈ 1,68 million de cas, bien en dessous de la seconde de calcul). Le moteur énumère donc **tous** les résultats possibles et agrège leurs probabilités exactes, plutôt que de faire des tirages aléatoires (Monte Carlo). Cela donne des résultats déterministes, instantanés, sans scintillement à l'affichage.

### `dice-pool.ts` — la brique de base

- `rollDicePool({ diceCount, discard? })` : énumère tous les jets de `diceCount` d6, applique une éventuelle défausse (garder les plus hauts/bas), et retourne la distribution agrégée `{ sum, hasDouble, probability }[]`.
- `hasDouble` : vrai si au moins deux dés lancés (avant défausse) affichent la même face — c'est le déclencheur de critique (double) dans WM/H.
- `rerollPoolOnceIfBelow(outcomes, threshold)` : modélise une relance unique si la somme est sous un seuil (simplification : ne conserve pas la corrélation avec `hasDouble` après relance).
- `probabilityAtLeast`, `probabilityOfDouble` : utilitaires d'agrégation.
- Garde-fou : lève une erreur au-delà de 8 dés (largement au-dessus de ce que le jeu produit).

### `attack-model.ts` — une attaque unique

Le calcul est scindé en deux étapes pour des raisons de performance (voir `sequence.ts`) :

1. **`buildAttackProfile(attack, damage, target, criticalEffects, autoHit)` → `AttackProfile`**
   Construit le profil probabiliste complet d'une attaque — indépendant du nombre de boîtes restantes de la cible :
   - `missChance`, `hitNonCritChance`, `hitCritChance`
   - `nonCritDamage` / `critDamage` : distributions `dégâts → probabilité`, conditionnelles à un coup non-critique / critique.
   - Si `autoHit` est vrai (cible Stationary, ou Knocked Down face à une attaque de mêlée), aucun jet de toucher n'est fait : `hitChance = 1`, `critChance = 0` (pas de dés de toucher lancés, donc pas de double possible).
   - Si un effet critique **Brutal Damage** (`criticalEffects.brutalDamageDice`) est actif, la distribution de dégâts critique utilise un pool de dés plus grand (dés supplémentaires) que la distribution non-critique.
   - C'est la partie coûteuse du calcul (énumération de dés) : elle n'est faite **qu'une seule fois par attaque**.

2. **`applyProfile(profile)` → `AppliedOutcome[]`**
   Éclate un profil en une liste plate `{ probability, isHit, isCrit, damageDealt }` (peu coûteux, itère juste sur les entrées des maps de distribution).

3. **`computeAttackOdds(input)` → `AttackOdds`**
   Fonction de haut niveau pour une attaque isolée (utilisée par les tests et conceptuellement par tout composant qui n'a besoin que d'une seule attaque) : construit le profil, l'applique, agrège en `hitChance`, `missChance`, `critOnHitChance`, `damageDistribution`, `expectedDamage`, `destroyChance` (avec prise en compte de Tough), `chanceOfAtLeast(n)`.

**Effets critiques pris en charge (`CriticalEffects`)** — liste volontairement courte et précise plutôt qu'un système générique flou :
- `knockdown` : sur critique, la cible devient Knocked Down (voir `sequence.ts` pour la persistance).
- `brutalDamageDice` : sur critique, ajoute N dés supplémentaires au jet de dégâts.

D'autres effets nommés (Decapitation, Sustained Attack, etc.) seront ajoutés une fois leurs règles exactes confirmées — volontairement non devinés pour ne pas introduire d'erreurs de règles dans un outil de calcul.

**Type d'attaque (`AttackType`)** : `'melee' | 'ranged' | 'arcane'`. Sert actuellement à conditionner l'auto-hit sur cible Knocked Down (seule la mêlée touche automatiquement une cible à terre ; tir et magie ne bénéficient d'aucun bonus/auto-hit dans le modèle actuel).

### `sequence.ts` — enchaînement de plusieurs attaques

`computeSequenceOdds(attacks: SequencedAttack[], target: SequenceTarget) → SequenceResult`

Calcule la probabilité de détruire une cible au fil d'une séquence d'attaques **ordonnée par l'utilisateur** (pas d'optimisation automatique de l'ordre — décision produit : voir documentation fonctionnelle).

**Modèle de calcul — distribution d'état, pas d'arbre combinatoire :**

Plutôt que de brancher un arbre de probabilités par attaque (explosion combinatoire), le moteur maintient une distribution de probabilité sur un **état de cible** :

```ts
interface TargetState {
  boxes: number;        // boîtes restantes
  knockedDown: boolean; // Knocked Down persistant (sticky) pour le reste de la séquence
  focusLeft: number;    // points de Focus restants à dépenser
  furyLeft: number;     // points de Fury restants à dépenser
  destroyed: boolean;   // état absorbant
}
```

Pour chaque attaque de la séquence, on "replie" (fold) son profil dans la distribution d'états courante :
- Pour chaque état vivant, on calcule si l'attaque doit être auto-hit (Knocked Down + mêlée, ou `forceAutoHit` explicite), on choisit le bon profil pré-calculé, et on répartit la probabilité de chaque issue vers les nouveaux états (boîtes réduites, ou détruit) — après application, le cas échéant, de la dépense **optimale** d'un point de Focus/Fury par la cible (voir plus bas).
- Un jet de Tough est retenté à chaque fois que des dégâts (après mitigation Focus/Fury éventuelle) seraient létaux (pas de limite "une fois par tour" dans cette modélisation — simplification documentée dans le code).
- Si Tough réussit, la cible est simplifiée à 1 boîte restante et Knocked Down (comportement standard de la règle Tough), pas de re-modélisation fine d'une grille de dégâts partielle.

**Pourquoi c'est rapide même à ~10 attaques :**

Le profil d'une attaque (`buildAttackProfile`, la partie qui énumère les dés — coûteuse) ne dépend **pas** du nombre de boîtes restantes de la cible. Il est donc calculé **une seule fois par attaque** (deux fois si l'attaque peut être auto-hit via Knockdown : un profil "normal" et un profil "auto-hit"), puis réappliqué à moindre coût contre chaque état rencontré. Le nombre d'états distincts après k attaques reste borné par `(boîtes initiales + 1) × 2 × (Focus+1) × (Fury+1)` — de l'ordre de quelques milliers au pire, jamais une explosion exponentielle. Un test de performance (`engine.spec.ts`) vérifie qu'une séquence de 10 attaques (avec ou sans points de ressource) s'exécute en moins de 2 secondes (en pratique quasi instantané).

**Dépense optimale de Focus/Fury — induction arrière (`valueTables`) :**

La cible peut dépenser, une fois par attaque et après le jet de dégâts, un point de Focus (réduit les dégâts de 5) ou un point de Fury (annule intégralement les dégâts), jamais les deux à la fois. On suppose qu'elle joue **de façon optimale**, ce qui veut dire : maximiser sa probabilité de survivre au **reste de la séquence**, pas seulement réagir au coup en cours. Comme la décision est prise avant de connaître les jets de dés futurs, mais avec une séquence d'attaques connue à l'avance, ce problème se résout par **induction arrière** (programmation dynamique) plutôt que par simulation forward pure :

1. **Passe arrière** : pour chaque attaque `k` (de la dernière à la première), on construit une table `valueTables[k][boxes][knockedDown][focusLeft][furyLeft]` = probabilité de survivre aux attaques `k..n-1` en jouant optimalement, calculée à partir de `valueTables[k+1]` (déjà connue) et du profil de l'attaque `k`. Le cas de base `valueTables[n]` vaut 1 partout (plus d'attaque = déjà survécu).
2. Pour chaque état et chaque issue de l'attaque `k`, `bestAction` (dans `sequence.ts`) compare les 3 choix possibles (ne rien dépenser / dépenser Focus / dépenser Fury) et retient celui qui maximise cette valeur de survie future.
3. **Passe avant** : on rejoue exactement la même politique (via les mêmes `valueTables`, déjà calculées) pour produire la distribution d'états réelle et les statistiques affichées (`hitChance`, `destroyChanceAtThisStep`, etc.).

**Départage des égalités.** Comparer uniquement "probabilité de survie du reste de la séquence" peut faire naître des égalités strictes (ex. la cible est de toute façon condamnée quelle que soit la décision, ou plus aucune attaque future ne dépend du nombre exact de boîtes restantes). Une comparaison naïve (`>` strict) résoudrait alors systématiquement ces égalités vers "ne rien dépenser", ce qui se traduit par un comportement contre-intuitif (la cible refuse de se défendre sur le coup en cours alors que cela ne lui coûterait rien). `bestAction` utilise donc un score **lexicographique à 3 niveaux** (voir `outcomeScore`/`isBetterScore`) : (1) probabilité de survie du reste de la séquence — le vrai objectif ; (2) à égalité, probabilité de survivre **à ce coup précis** ; (3) à égalité sur les deux, nombre de boîtes préservées. Ce n'est qu'en cas d'égalité totale sur les 3 niveaux que le point n'est pas dépensé (comportement par défaut : conserver la ressource).

**Résultat retourné (`SequenceResult`)** :
- `steps[]` : pour chaque attaque, `hitChance` (conditionnelle à la cible encore vivante), `destroyChanceAtThisStep` (probabilité de destruction *exactement* à cette étape), `cumulativeDestroyChance`, `expectedBoxesRemaining`.
- `finalDestroyChance` : probabilité totale de destruction sur l'ensemble de la séquence.

**Garde-fou** : `focusPoints`/`furyPoints` sont plafonnés à 10 (`MAX_RESOURCE_POINTS`) — au-delà, `computeSequenceOdds` lève une erreur plutôt que de construire une table de valeurs disproportionnée. L'UI clampe silencieusement la saisie dans cette plage avant d'appeler le moteur.
- `survivalDistribution` : distribution des boîtes restantes, conditionnelle à la survie de la cible.

### `odds-engine.ts` — pont avec Angular

`@Injectable({ providedIn: 'root' })` — expose `compute()` (attaque unique) et `computeSequence()` (séquence complète) aux composants via injection de dépendances. Ne contient aucune logique : c'est uniquement un point d'entrée DI, qui laisse la porte ouverte à du cache ou des profils sauvegardés plus tard sans toucher au moteur.

## Le composant UI (`src/app/odds-calculator/`)

Composant standalone (`OddsCalculator`), `ChangeDetectionStrategy.OnPush`, entièrement piloté par des **signals** Angular (recalcul automatique, aucun bouton "calculer").

### Modèle de données du formulaire

- **Cible partagée** (`targetDef`, `targetArm`, `targetBoxes`, `tough`, `toughOn`) : signals simples au niveau du composant.
- **Séquence d'attaques** (`rows: WritableSignal<AttackRow[]>`) : chaque ligne (`AttackRow`) est un objet dont **chaque champ est lui-même un signal** (`attackerName`, `label`, `type`, `stat`, `boostDice`, `forceAutoHit`, `pow`, `damageBoostDice`, `knockdown`, `brutalDamageDice`).

  **Pourquoi cette structure et pas un simple tableau d'objets JS ?** Avec les signals Angular, muter un objet imbriqué dans un tableau signal ne déclenche pas de recalcul (le signal ne détecte que le remplacement de sa propre valeur). Deux options : (a) cloner tout le tableau à chaque frappe clavier, ou (b) donner à chaque champ son propre signal, that `computed()` lira individuellement et pourra donc suivre finement. L'option (b) est retenue ici : ajouter/retirer/réordonner une ligne remplace le tableau (`rows.update(...)`), mais éditer un champ ne touche que son signal — pas de clonage profond nécessaire.

- `sequencedAttacks` (computed) : projette `rows()` vers `SequencedAttack[]` (le type attendu par le moteur).
- `sequence` (computed) : appelle `engine.computeSequence(...)` — recalculé automatiquement dès qu'un signal lu à l'intérieur change (cible ou n'importe quel champ de n'importe quelle ligne).

### Actions

- `addAttack()` : ajoute une ligne (préremplit le nom d'attaquant avec celui de la dernière ligne, pour enchaîner facilement plusieurs attaques du même attaquant).
- `removeAttack(id)` : retire une ligne (au moins 1 ligne toujours présente).
- `moveAttack(id, -1|+1)` : réordonne (l'ordre saisi par l'utilisateur *est* l'ordre de résolution — voir doc fonctionnelle).

## PWA

- `@angular/service-worker` activé uniquement hors mode dev (`enabled: !isDevMode()`), stratégie d'enregistrement `registerWhenStable:30000`.
- `ngsw-config.json` : préfetch des fichiers applicatifs (HTML/CSS/JS/manifest), cache lazy des icônes.
- `public/manifest.webmanifest` + `public/icons/*` : icônes multi-résolutions pour l'installation sur écran d'accueil (Android et iOS).
- Aucun appel réseau applicatif : l'app fonctionne entièrement hors-ligne une fois chargée/installée.

## Commandes

```bash
npm start        # ng serve — serveur de dev sur http://localhost:4200
npm run build     # ng build — build de production dans dist/
npm test          # ng test — exécute les tests Vitest via le builder Angular
```

⚠️ Exécuter `npx vitest run` directement (sans passer par `ng test`) fait échouer `app.spec.ts` (`describe is not defined`) car les globals de test Angular ne sont pas injectés hors du builder `@angular/build:unit-test`. Toujours utiliser `npm test` / `ng test` pour une exécution fiable.

## Décisions de conception à retenir

- **Édition de règles ciblée : Warmachine MK4** (choix utilisateur). Les mécaniques de base (2d6, boost, double = critique, Tough) sont considérées stables et communes aux éditions ; les effets nommés spécifiques (Knockdown, Brutal Damage) sont implémentés avec la formulation la plus largement admise, mais restent à vérifier/ajuster face au livre de règles MK4 exact — voir doc fonctionnelle pour le détail des hypothèses.
- **Ordre des attaques dans une séquence : défini par l'utilisateur**, pas d'optimisation automatique (décision produit assumée, voir doc fonctionnelle pour la justification et les limites).
- **Effets critiques : liste courte et exacte plutôt qu'un système générique** — extensible facilement dans `CriticalEffects` au fur et à mesure que de nouvelles règles sont confirmées.
- **Dépense de Focus/Fury par la cible : optimale via induction arrière, pas un simple réflexe "je dépense si ce coup me tuerait sinon"** — pertinent car un point peut valoir mieux dépensé plus tôt (pour préserver des boîtes utiles à la survie d'un coup futur) que gardé "au cas où". Le calcul reste exact (pas d'heuristique), au prix d'une table de valeurs par attaque plutôt que d'une simple règle locale.
