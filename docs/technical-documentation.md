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
  destroyed: boolean;   // état absorbant
}
```

Pour chaque attaque de la séquence, on "replie" (fold) son profil dans la distribution d'états courante :
- Pour chaque état vivant, on calcule si l'attaque doit être auto-hit (Knocked Down + mêlée, ou `forceAutoHit` explicite), on choisit le bon profil pré-calculé, et on répartit la probabilité de chaque issue vers les nouveaux états (boîtes réduites, ou détruit).
- Un jet de Tough est retenté à chaque fois que des dégâts seraient létaux (pas de limite "une fois par tour" dans cette modélisation — simplification documentée dans le code).
- Si Tough réussit, la cible est simplifiée à 1 boîte restante et Knocked Down (comportement standard de la règle Tough), pas de re-modélisation fine d'une grille de dégâts partielle.

**Pourquoi c'est rapide même à ~10 attaques :**

Le profil d'une attaque (`buildAttackProfile`, la partie qui énumère les dés — coûteuse) ne dépend **pas** du nombre de boîtes restantes de la cible. Il est donc calculé **une seule fois par attaque** (deux fois si l'attaque peut être auto-hit via Knockdown : un profil "normal" et un profil "auto-hit"), puis réappliqué à moindre coût contre chaque état de boîtes-restantes rencontré. Le nombre d'états distincts après k attaques reste borné par `(boîtes initiales + 1) × 2` (knockedDown oui/non) — de l'ordre de quelques dizaines, jamais une explosion exponentielle. Un test de performance (`engine.spec.ts`) vérifie qu'une séquence de 10 attaques s'exécute en moins de 2 secondes (en pratique quasi instantané).

**Résultat retourné (`SequenceResult`)** :
- `steps[]` : pour chaque attaque, `hitChance` (conditionnelle à la cible encore vivante), `destroyChanceAtThisStep` (probabilité de destruction *exactement* à cette étape), `cumulativeDestroyChance`, `expectedBoxesRemaining`.
- `finalDestroyChance` : probabilité totale de destruction sur l'ensemble de la séquence.
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
