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

**Jets extrêmes (`isHitOutcome`).** En dehors du cas `autoHit`, le jet pour toucher applique une règle supplémentaire avant la comparaison classique somme-vs-DEF : tous les dés **conservés** (après défausse éventuelle) à 1 est toujours un échec, et tous à 6 est toujours une réussite (sauf si un seul dé est conservé). Comme la face d'un dé est toujours ≥ 1, la somme de N dés ne peut valoir exactement N que si chacun affiche 1, et ne peut valoir 6N que si chacun affiche 6 - `isHitOutcome` détecte donc ces deux cas uniquement à partir de `outcome.sum` et du nombre de dés conservés (`keptDiceCount`), sans avoir besoin d'inspecter chaque face individuellement ni de faire remonter une information supplémentaire depuis `dice-pool.ts`. Une réussite forcée par "tous 6" avec 2+ dés est nécessairement aussi un double, donc un critique (`hasDouble` est vrai dès que ≥2 dés affichent la même face) - aucun traitement spécial n'est nécessaire pour que `hitCritChance` la compte correctement.

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
- `steps[]` : pour chaque attaque, `hitChance`, `critChance` et `averageDamage` (les trois conditionnels à la cible encore vivante à ce moment de la séquence - mêmes accumulateurs `hitMass`/`critMass`/`damageMass` que la boucle de simulation forward existante, juste normalisés par `aliveMass`), ainsi que `destroyChanceAtThisStep` (probabilité de destruction *exactement* à cette étape), `cumulativeDestroyChance`, `expectedBoxesRemaining`. `averageDamage` est le dégât **brut** du jet (dés + POW − ARM), avant toute mitigation Focus/Fury - une propriété de l'attaque, pas de l'état de la cible à cet instant (ces deux derniers champs, avec `destroyChanceAtThisStep`/`cumulativeDestroyChance`, restent calculés en interne mais ne sont plus affichés dans la pop-up Details - voir doc fonctionnelle).
- `finalDestroyChance` : probabilité totale de destruction sur l'ensemble de la séquence.
- `survivalDistribution` : distribution des boîtes restantes, conditionnelle à la survie de la cible.

**Garde-fou** : `focusPoints`/`furyPoints` sont plafonnés à 10 (`MAX_RESOURCE_POINTS`) — au-delà, `computeSequenceOdds` lève une erreur plutôt que de construire une table de valeurs disproportionnée. L'UI clampe silencieusement la saisie dans cette plage avant d'appeler le moteur.

**`SequenceTarget.def: number | 'KD'`.** Si `def === 'KD'`, la cible commence toute la séquence Knocked Down. Contrairement à une première implémentation qui forçait `autoHit` pour tous les types d'attaque (corrigé - Knocked Down n'aide pas contre le tir/la magie, voir doc fonctionnelle), c'est maintenant géré en réutilisant **exactement** le mécanisme déjà en place pour un Knockdown déclenché en cours de séquence par un critique :
- `startsKnockedDown` (booléen, `target.def === 'KD'`) sert uniquement à initialiser l'état `knockedDown` du tout premier pas de la simulation forward à `true` au lieu de `false` - la logique `knockdownGates && state.knockedDown` (mêlée uniquement) qui décide de l'auto-hit à chaque étape est totalement inchangée et ne sait même pas si la cible a démarré à terre ou l'est devenue en cours de route.
- `profileTarget.def` retombe sur `5` (au lieu d'une valeur factice jamais lue) quand `def === 'KD'`, puisque les attaques de tir/magie en ont désormais réellement besoin pour leur jet normal contre la DEF au sol.

**`AttackRow.pow: number | '-'`** (composant UI) : `'-'` représente une attaque qui ne fait jamais de dégâts (mais peut toujours critiquer, un effet critique comme Knockdown restant possible). Traduit en `NO_DAMAGE_POW = -9999` avant d'atteindre le moteur (`resolvePow` dans `odds-calculator.ts`) — un POW aussi négatif garantit `max(0, dés + pow - arm) === 0` quels que soient les dés ou l'ARM, sans qu'aucun changement du moteur ne soit nécessaire.

### `odds-engine.ts` — pont avec Angular

`@Injectable({ providedIn: 'root' })` — expose `compute()` (attaque unique) et `computeSequence()` (séquence complète) aux composants via injection de dépendances. Ne contient aucune logique : c'est uniquement un point d'entrée DI, qui laisse la porte ouverte à du cache ou des profils sauvegardés plus tard sans toucher au moteur.

## Le composant UI (`src/app/odds-calculator/`)

Composant standalone (`OddsCalculator`), `ChangeDetectionStrategy.OnPush`, entièrement piloté par des **signals** Angular (recalcul automatique, aucun bouton "calculer").

### Modèle de données du formulaire

- **Cible partagée** (`targetDef`, `targetArm`, `targetBoxes`, `tough`, `toughOn`, `targetFocus`, `targetFury`) : signals simples au niveau du composant, affichés sur une seule ligne (`.target-row`).
- **Séquence d'attaques** (`rows: WritableSignal<AttackRow[]>`) : chaque ligne (`AttackRow`) est un objet dont **chaque champ est lui-même un signal** (`type`, `stat`, `diceCount`, `forceAutoHit`, `pow`, `damageDiceCount`, `knockdown`, `brutalDamageDice`). Pas de nom d'attaquant ni de libellé éditable : le libellé affiché dans les résultats (`Attack N`) est généré à partir de la position de la ligne.

  **Pourquoi cette structure et pas un simple tableau d'objets JS ?** Avec les signals Angular, muter un objet imbriqué dans un tableau signal ne déclenche pas de recalcul (le signal ne détecte que le remplacement de sa propre valeur). Deux options : (a) cloner tout le tableau à chaque frappe clavier, ou (b) donner à chaque champ son propre signal, que `computed()` lira individuellement et pourra donc suivre finement. L'option (b) est retenue ici : ajouter/retirer une ligne remplace le tableau (`rows.update(...)`), mais éditer un champ ne touche que son signal — pas de clonage profond nécessaire.

- **`diceCount` / `damageDiceCount`** : l'utilisateur choisit directement le **nombre total** de dés lancés (2 par défaut), pas un nombre de dés de boost. `toBoostDice(diceCount)` fait la conversion (`max(0, diceCount - 2)`) au moment de construire l'objet `SequencedAttack` envoyé au moteur, qui raisonne en base 2d6 + boost.
- `sequencedAttacks` (computed) : projette `rows()` vers `SequencedAttack[]` (le type attendu par le moteur), génère le libellé `Attack ${i+1}` à partir de l'index, convertit `pow` via `resolvePow` (voir plus haut).
- `sequence` (computed) : appelle `engine.computeSequence(...)` — recalculé automatiquement dès qu'un signal lu à l'intérieur change (cible ou n'importe quel champ de n'importe quelle ligne).

### Champs numériques en `<select>` plutôt qu'en `<input type="number">`

Tous les champs à plage connue (DEF, ARM, Boxes, Focus, Fury, MAT/RAT/AAT, POW, Dice) sont des `<select>` plutôt que des `<input type="number">`, pour que le choix d'une valeur ouvre un sélecteur natif sur mobile plutôt que le clavier. Les listes d'options (`DEF_OPTIONS`, `ARM_OPTIONS`, etc., en tête de `odds-calculator.ts`) sont générées une fois via `range(start, end)`.

Le seuil de réussite de Tough n'est plus configurable (retiré : `toughOn`) - la règle reste toujours 5+, qui est aussi la valeur par défaut de `SequenceTarget.toughOn` côté moteur (`target.toughOn ?? 5`), donc le composant n'a plus besoin de la transmettre du tout.

**Piège à connaître : `<select>` + `ngModel` communique toujours en chaînes de caractères.** Un `<select>` natif ne connaît que des valeurs `value` de type `string` ; `(ngModelChange)` émet donc systématiquement une chaîne, jamais un nombre, même quand `[ngModel]` reçoit un nombre en entrée. Chaque binding reconvertit explicitement : `toNumber(raw)` pour les champs numériques classiques, et `parseDef`/`parsePow` pour DEF/POW qui acceptent en plus une valeur sentinelle (`'KD'`, `'-'`) à ne surtout pas convertir en nombre.

### Actions

- `addAttack()` : ajoute une ligne en clonant les valeurs de la dernière ligne (`cloneAttackRow`, nouveaux signals initialisés à la même valeur - pas de référence partagée avec la ligne source), ou une ligne par défaut (`createAttackRow`) s'il n'y en a pas encore.
- `removeAttack(id)` : retire une ligne (au moins 1 ligne toujours présente).

Pas de bouton pour réordonner les lignes (retiré : voir doc fonctionnelle) - l'ordre se construit uniquement en ajoutant les attaques dans l'ordre voulu.

### Pop-ups (Effects / Details)

Les effets spéciaux par attaque (Auto-hit, Crit: Knockdown, Crit: Brutal Damage) et le détail des résultats (step-by-step, distribution des boîtes restantes) sont déplacés dans des pop-ups plutôt qu'affichés en permanence, pour garder la ligne d'attaque et le résumé des résultats compacts.

Implémentation : élément HTML natif **`<dialog>`** (pas de librairie de modal/CDK) avec `@ViewChild` + `.showModal()` :
- `editingRow: WritableSignal<AttackRow | null>` retient la ligne actuellement éditée ; `openEffects(row)` la renseigne puis ouvre la pop-up, dont le contenu (`@if (editingRow(); as row)`) se lie directement aux signals de cette ligne.
- Une seule pop-up "Effects" est réutilisée pour toutes les lignes (plutôt qu'une pop-up par ligne), et une seule pop-up "Details" pour les résultats.
- `closeOnBackdropClick(event, dialog)` ferme la pop-up au clic en dehors de son contenu : pour un `<dialog>` ouvert en mode modal, un clic sur le `::backdrop` remonte un événement `click` dont la `target` est l'élément `dialog` lui-même (pas un enfant) — cette propriété permet de distinguer "clic sur le fond" de "clic à l'intérieur du contenu" sans `stopPropagation()`. La touche Échap ferme nativement la pop-up sans code additionnel.

### App shell : titre/Target/Results fixes, seule Attack sequence défile

Le composant est structuré comme un app shell en trois zones empilées dans un conteneur de hauteur fixe (`height: 100dvh` sur `.page`, propagé via `display:flex; flex-direction:column; height:100%` sur `:host` puis `.panel`, `.panel__body`) : `.console`/`.readout` (Target et Results) ont `flex-shrink: 0` (taille naturelle, jamais compressés), et seule `.console--attacks` porte `flex: 1 1 auto; min-height: 0`, ce qui lui fait occuper tout l'espace restant entre Target et Results. À l'intérieur, c'est `.attack-list` (pas toute la section) qui a `overflow-y: auto` - le titre "Attack sequence" et le bouton "+ Add attack" restent donc visibles au-dessus et en dessous de la liste qui défile.

**`min-height: 0` est essentiel à chaque niveau de cette chaîne flexbox.** Sans lui, un flex item en colonne refuse par défaut de rétrécir en dessous de la hauteur de son contenu (même piège `min-*:auto` que pour la largeur des lignes compactes, voir plus bas) - ce qui aurait empêché `.attack-list` d'être jamais plus petit que son contenu, et donc de jamais scroller : toute la page aurait poussé en hauteur à la place.

`100dvh` plutôt que `100vh` sur `.page` (`app.css`) : sur mobile, la barre d'adresse du navigateur apparaît/disparaît en défilant, ce qui fait varier la hauteur réellement visible. `100vh` est calculé sur la hauteur maximale (barre cachée), ce qui peut laisser le bas de l'écran (ici, Results) partiellement caché derrière la barre d'adresse quand elle est visible ; `dvh` (*dynamic* viewport height) suit la hauteur réellement visible à tout instant. `100vh` reste écrit en premier comme repli pour les navigateurs qui ne supportent pas `dvh`.

### Barres de défilement masquées

`.target-row`, `.attack-row` (défilement horizontal) et `.attack-list` (défilement vertical) masquent leur barre de défilement (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) tout en restant défilables (souris/trackpad/tactile) - une barre visible se serait retrouvée juste sous/à côté des chiffres des champs et les aurait visuellement encombrés.

### Lignes compactes, centrées et espacées, tenant sur une seule ligne (mobile inclus)

Le Target et chaque ligne d'attaque utilisent `flex-wrap: nowrap` plutôt que `wrap` : l'objectif est que tout tienne sur une seule ligne même sur un téléphone étroit, quitte à défiler horizontalement plutôt que de passer à la ligne suivante. Les champs sont centrés horizontalement sur la ligne (`justify-content: safe center` sur `.target-row`/`.attack-row`) avec un `gap` généreux entre eux ; les valeurs à l'intérieur de chaque champ sont elles-mêmes centrées (`text-align`/`text-align-last: center` sur `.mini-field__input`, `align-items: center` sur `.mini-field`).

Le mot-clé `safe` dans `justify-content: safe center` évite un piège connu : avec un simple `center`, si la ligne finit par déborder (viewport très étroit, ou davantage de champs ajoutés plus tard), le début du contenu peut devenir inatteignable au défilement dans certains navigateurs - `safe` retombe sur un alignement de type `start` dans ce cas précis, pour que le défilement horizontal (`overflow-x: auto`) reste toujours capable de tout montrer.

**Alignement vertical des contrôles (`--control-h`).** Tous les contrôles d'une ligne (`<select>`, boutons Effects/✕, case Tough) partagent la même hauteur explicite via la variable `--control-h` (définie dans `:host`), plutôt que de compter sur `align-items: flex-end` seul pour les aligner visuellement. Avant cette variable, chaque contrôle avait une hauteur légèrement différente (padding/bordure propres à chaque type d'élément), et même si `flex-end` alignait mathématiquement leurs bas de boîte au pixel près, les tailles visuellement différentes donnaient une impression de désalignement. La case à cocher Tough est en plus enveloppée dans un `<span class="mini-field__control">` (`height: var(--control-h)`, centré) : ça réserve la même hauteur de "ligne de contrôle" que les autres champs sans agrandir la case à cocher elle-même (qui reste à sa taille native habituelle).

**Flèche de `<select>` personnalisée, minimaliste.** La flèche native d'un `<select>` réserve un espace dépendant du navigateur/OS (souvent 20px+), ce qui laissait peu de marge pour tenir sur une ligne une fois les champs numériques convertis en `<select>`. `.mini-field__input--select` désactive le rendu natif (`appearance: none`) et dessine une flèche minuscule via `background-image` (deux dégradés linéaires formant un chevron), ce qui permet de maîtriser exactement l'espace qu'elle occupe - et laisse la valeur réellement centrée plutôt que décalée par une flèche large.

Deux pièges CSS rencontrés en implémentant le "tient sur une seule ligne", à garder en tête si ces règles sont retouchées :
- **`min-width: 0` sur `:host`** : ce composant est lui-même un item flexbox du conteneur `.page` (`app.css`). Par défaut, un item flexbox refuse de rétrécir en dessous de la largeur minimale de son contenu (`min-width: auto`) - avec des lignes en `nowrap`, ce contenu minimal peut dépasser la largeur de l'écran, ce qui aurait fait déborder **toute la page** (et pas juste défiler dans la ligne) sans ce `min-width: 0`. C'est le piège flexbox classique "min-width:auto empêche de rétrécir".
- **`box-sizing: border-box` global** (`src/styles.css`) : sans ça, `width` sur les inputs ne compte pas le padding ni la bordure, ce qui rendait les calculs de largeur (viser "tout tient dans 375px") imprévisibles - chaque input rendait plusieurs pixels plus large que sa largeur déclarée.

**Piège de mesure à connaître si ces largeurs sont retouchées à la main dans le navigateur** : ce composant tourne sans zone.js (Angular zoneless), donc après avoir modifié un signal depuis la console (`ng.getComponent(...)`), lire `scrollWidth`/`clientWidth` **immédiatement** peut renvoyer des valeurs d'avant le rendu - le changement de vue est planifié, pas synchrone. Attendre deux `requestAnimationFrame` avant de mesurer (ou simplement re-régarder après une capture d'écran suivante) évite de conclure à tort qu'une ligne "tient" alors que le DOM n'avait pas encore rattrapé le nouvel état.

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
