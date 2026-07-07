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

- `rollDicePool({ diceCount, discard?, treatOnesAsSixes?, extraCritDice? })` : énumère tous les jets de `diceCount` d6 (plus, le cas échéant, `extraCritDice` dés supplémentaires), applique dans l'ordre `treatOnesAsSixes` (Jump the Shark — chaque 1 devient un 6 avant tout le reste), puis l'éventuelle défausse (garder les plus hauts/bas), puis calcule la somme et retourne la distribution agrégée `{ sum, hasDouble, probability }[]`.
  - `discard?: { highest?: number; lowest?: number }` : les deux comptes sont indépendants et **peuvent être actifs simultanément** sur le même jet (ex. `{ highest: 1, lowest: 1 }` sur 4 dés garde les deux dés du milieu). `applyDiscard(dice, highestCount, lowestCount)` trie les dés puis découpe `sorted.slice(lowestCount, Math.max(lowestCount, sorted.length - highestCount))` — le `Math.max` évite un `slice` avec une borne de fin inférieure à la borne de départ si la somme des deux dépasse le nombre de dés disponibles (auquel cas le résultat est simplement une liste vide, sommant à 0, plutôt qu'une erreur).
  - `treatOnesAsSixes` (Jump the Shark) : transforme chaque dé montrant 1 en 6 avant la défausse/somme/détection de double — implémenté au plus bas niveau (sur chaque face individuelle) pour que la défausse et la détection de double voient déjà les faces transformées.
  - `extraCritDice` (Sanguine Fate) : `N` dés supplémentaires lancés en même temps que le pool, qui comptent pour la détection de `hasDouble` (un double avec un dé "extra" déclenche bien un critique) mais ne sont **jamais** inclus dans `sum` — implémenté en itérant `diceCount + extraCritDice` dés au total, dont seuls les `diceCount` premiers alimentent la défausse/somme.
- `hasDouble` : vrai si au moins deux dés lancés (avant défausse, en comptant les dés Sanguine Fate) affichent la même face — c'est le déclencheur de critique (double) dans WM/H.
- `rerollPoolOnceIf(outcomes, isBad)` : modélise une relance unique et optionnelle des jets flagués `isBad`, en conservant correctement la corrélation `(sum, hasDouble)` : chaque issue conservée garde son propre `hasDouble`, et la masse de probabilité relancée se redistribue sur **toute** la distribution d'origine (y compris ses valeurs de `hasDouble`) plutôt que d'écraser `hasDouble` à `false`. C'est la version corrigée d'un bug antérieur (voir plus bas) : l'ancienne implémentation mettait `hasDouble: false` sur tous les jets relancés, ce qui annulait silencieusement toute chance de critique sur une attaque avec relance.
- `rerollPoolOnceIfBelow(outcomes, threshold)` : enrobage pratique de `rerollPoolOnceIf` pour le cas "relancer si la somme est sous un seuil" (jet de dégâts sous la moyenne).
- `probabilityAtLeast`, `probabilityOfDouble` : utilitaires d'agrégation.
- Garde-fou : lève une erreur au-delà de 8 dés au total (`diceCount + extraCritDice`), largement au-dessus de ce que le jeu produit.

**Bug corrigé : `hasDouble` écrasé par une relance.** La première implémentation de la relance (`rerollPoolOnceIfBelow`) forçait `hasDouble: false` sur *tous* les jets après relance, y compris les jets conservés sans être relancés — un jet naturellement critique pouvait donc perdre son statut de critique simplement parce que la relance était activée sur cette attaque. Corrigé en généralisant vers `rerollPoolOnceIf(outcomes, isBad)`, qui ne touche `hasDouble` que via la redistribution correcte décrite ci-dessus.

### `attack-model.ts` — une attaque unique

Le calcul est scindé en deux étapes pour des raisons de performance (voir `sequence.ts`) :

1. **`buildAttackProfile(attack, damage, target, effects, autoHit)` → `AttackProfile`**
   Construit le profil probabiliste complet d'une attaque — indépendant du nombre de boîtes restantes de la cible :
   - `missChance`, `hitNonCritChance`, `hitCritChance`
   - `nonCritDamage` / `critDamage` : distributions `dégâts → probabilité`, conditionnelles à un coup non-critique / critique.
   - Si `autoHit` est vrai (cible Stationary/Knocked Down face à une attaque de mêlée, ou `forceAutoHit` explicite), aucun jet de toucher n'est fait : `hitChance = 1`, `critChance = 0` (pas de dés de toucher lancés, donc pas de double possible).
   - Si **Brutal Damage** (`effects.brutalDamageDice`) est actif, la distribution de dégâts critique utilise un pool de dés plus grand (dés supplémentaires) que la distribution non-critique.
   - **Armor Piercing** (`effects.armorPiercing: EffectTrigger`) : l'ARM utilisée pour le jet de dégâts (non-critique et/ou critique, selon `appliesOnNonCritHit`/`appliesOnCritHit`) est remplacée par `Math.ceil(target.baseArm / 2)` — `baseArm` est l'ARM **avant** tout malus persistant (voir `sequence.ts`), volontairement distincte de `target.arm` (l'ARM effective, malus compris) pour que l'effet ignore bien les malus déjà en cours, comme spécifié.
   - **Decapitation** (`effects.decapitation: EffectTrigger`) : la distribution de dégâts concernée est doublée après coup via `doubleDamageValues` (chaque `(dégâts, p)` devient `(dégâts × 2, p)`).
   - **Trash** / **Shatter** (`effects.trash` / `effects.shatter`, booléens) : un dé de dégâts supplémentaire est ajouté si `target.knockedDown` / `target.stationary` est vrai **au moment de cette attaque** — ces deux flags sont des booléens simples passés par `sequence.ts`, qui est seul responsable de savoir si la cible est actuellement dans cet état.
   - C'est la partie coûteuse du calcul (énumération de dés) : elle n'est faite **qu'une seule fois par attaque** (par contexte DEF/ARM/statut distinct, voir `sequence.ts`).

2. **`applyProfile(profile)` → `AppliedOutcome[]`**
   Éclate un profil en une liste plate `{ probability, isHit, isCrit, damageDealt }` (peu coûteux, itère juste sur les entrées des maps de distribution).

3. **`computeAttackOdds(input)` → `AttackOdds`**
   Fonction de haut niveau pour une attaque isolée (utilisée par les tests et conceptuellement par tout composant qui n'a besoin que d'une seule attaque) : construit le profil, l'applique, agrège en `hitChance`, `missChance`, `critOnHitChance`, `damageDistribution`, `expectedDamage`, `destroyChance` (avec prise en compte de Tough), `chanceOfAtLeast(n)`.

**Modificateurs de jet (`RollModifiers`)**, appliqués sur le jet pour toucher et/ou le jet de dégâts indépendamment (chacun a ses propres `modifiers`/`damageModifiers`) :
- `boostDice` : dés supplémentaires ajoutés au pool de base (2d6).
- `discard` : défausse `{ highest?: number; lowest?: number }` avant de sommer - les deux peuvent être définis en même temps (voir `dice-pool.ts` ci-dessus).
- `reroll` : relance optionnelle unique — voir `applyRerollIfConfigured` ci-dessous.
- `treatOnesAsSixes` (Jump the Shark), `extraCritDice` (Sanguine Fate) : transmis tels quels à `rollDicePool` (voir `dice-pool.ts`).

**Relance (`applyRerollIfConfigured` + `isBadDamageRoll`)** : quand `modifiers.reroll` est actif, le pool est relancé via `rerollPoolOnceIf` avec un critère "mauvais jet" différent selon le contexte :
- Jet pour toucher : "mauvais" = `!isHitOutcome(...)` (le jet raterait réellement — pas une simple comparaison `sum < neededDiceSum`, voir plus bas pourquoi).
- Jet de dégâts : "mauvais" = `isBadDamageRoll`, c'est-à-dire une somme strictement sous la moyenne (`sum < 3.5 × diceCount`) — relancer un jet sous la moyenne maximise strictement l'espérance de dégâts, donc aucun seuil configurable n'est nécessaire côté UI.

**Effets pris en charge (`AttackEffects`, ex-`CriticalEffects`)** — liste volontairement courte et précise plutôt qu'un système générique flou, mais qui a grandi par rapport à sa première version (qui ne contenait que Knockdown et Brutal Damage — Knockdown a depuis été déplacé dans le système générique `StatEffect` de `sequence.ts`, voir plus bas) :
```ts
type EffectTrigger = 'hit' | 'crit'; // 'hit' se déclenche sur n'importe quelle touche (crit compris) ; 'crit' uniquement sur critique

interface AttackEffects {
  brutalDamageDice?: number;      // crit only, pas de trigger configurable
  armorPiercing?: EffectTrigger;
  decapitation?: EffectTrigger;
  trash?: boolean;
  shatter?: boolean;
}
```
`appliesOnNonCritHit(trigger)` (`=== 'hit'`) et `appliesOnCritHit(trigger)` (`=== 'hit' || === 'crit'`) centralisent cette logique de déclenchement — un effet à `trigger: 'hit'` s'applique donc aussi sur un critique (un critique est un cas particulier de touche), alors que `trigger: 'crit'` ne s'applique que sur critique.

**Type d'attaque (`AttackType`)** : `'melee' | 'ranged' | 'arcane'`. Sert actuellement à conditionner l'auto-hit sur cible Knocked Down/Stationary (seule la mêlée touche automatiquement une cible immobilisée ; tir et magie lancent un jet normal contre une DEF plafonnée à 5 dans ce cas, voir `sequence.ts`).

**Jets extrêmes (`isHitOutcome`).** En dehors du cas `autoHit`, le jet pour toucher applique une règle supplémentaire avant la comparaison classique somme-vs-DEF : tous les dés **conservés** (après défausse éventuelle) à 1 est toujours un échec, et tous à 6 est toujours une réussite (sauf si un seul dé est conservé). Comme la face d'un dé est toujours ≥ 1, la somme de N dés ne peut valoir exactement N que si chacun affiche 1, et ne peut valoir 6N que si chacun affiche 6 - `isHitOutcome` détecte donc ces deux cas uniquement à partir de `outcome.sum` et du nombre de dés conservés (`keptDiceCount`), sans avoir besoin d'inspecter chaque face individuellement ni de faire remonter une information supplémentaire depuis `dice-pool.ts`. Une réussite forcée par "tous 6" avec 2+ dés est nécessairement aussi un double, donc un critique (`hasDouble` est vrai dès que ≥2 dés affichent la même face) - aucun traitement spécial n'est nécessaire pour que `hitCritChance` la compte correctement.

### `sequence.ts` — enchaînement de plusieurs attaques

`computeSequenceOdds(attacks: SequencedAttack[], target: SequenceTarget) → SequenceResult`

Calcule la probabilité de détruire une cible au fil d'une séquence d'attaques **ordonnée par l'utilisateur** (pas d'optimisation automatique de l'ordre — décision produit : voir documentation fonctionnelle).

**Modèle de calcul — distribution d'état, pas d'arbre combinatoire :**

Plutôt que de brancher un arbre de probabilités par attaque (explosion combinatoire), le moteur maintient une distribution de probabilité sur un **état de cible**, dont la partie "malus persistants" est regroupée dans `DebuffState` :

```ts
interface DebuffState {
  knockedDown: boolean;
  stationary: boolean;   // Ice Cage à 2+ cumuls rend aussi la cible Stationary, voir isStationary
  iceCageStacks: number; // seul malus explicitement cumulable en dehors de armPenalty
  shadowbind: boolean;
  blind: boolean;
  paralyzed: boolean;
  flare: boolean;
  weaken: boolean;
  armPenalty: number;    // "-X ARM" générique, cumulatif
}
```

... combinée avec `boxes` (boîtes restantes), `focusLeft`/`furyLeft` (points de ressource restants) et `destroyed` (état absorbant) dans le reste du calcul. Pour chaque attaque de la séquence, on "replie" (fold) son profil dans la distribution d'états courante :
- Pour chaque état vivant, on calcule la DEF/ARM effectives (`effectiveDef`/`baseArm - debuffState.armPenalty`) et si l'attaque doit être auto-hit (mêlée + `isKnockedDownOrStationary`, ou `forceAutoHit` explicite), on choisit le bon profil pré-calculé, et on répartit la probabilité de chaque issue vers les nouveaux états (boîtes réduites et/ou nouveaux malus, ou détruit) — après application, le cas échéant, de la dépense **optimale** d'un point de Focus/Fury par la cible (voir plus bas).
- Un jet de Tough est retenté à chaque fois que des dégâts (après mitigation Focus/Fury éventuelle) seraient létaux (pas de limite "une fois par tour" dans cette modélisation — simplification documentée dans le code).
- Si Tough réussit, la cible est simplifiée à 1 boîte restante et Knocked Down (comportement standard de la règle Tough), pas de re-modélisation fine d'une grille de dégâts partielle — cette règle est ce qui couple le sous-problème "malus persistants" au sous-problème "boîtes/ressources" (voir plus bas).

**Effets persistants (`StatEffect` / `StatEffectType`)** : chaque attaque porte une liste optionnelle `statEffects: StatEffect[]`, chacun `{ type, trigger, amount? }` (`amount` uniquement pour `'armPenalty'`). `applyStatEffectsForOutcome(state, statEffects, isCrit)` applique, pour une issue (touche ou critique) donnée, tous les effets dont le trigger correspond (`'hit'` se déclenche sur n'importe quelle touche y compris critique ; `'crit'` uniquement sur critique) via `applyStatEffect` :
- Tous les flags booléens (`knockedDown`, `stationary`, `shadowbind`, `blind`, `paralyzed`, `flare`, `weaken`) sont **idempotents** — les redéclencher n'a aucun effet supplémentaire, conformément à la règle "un effet ne s'applique qu'une fois sauf mention contraire".
- `iceCageStacks` s'incrémente à chaque déclenchement (seul flag explicitement cumulable avec les booléens), `armPenalty` s'additionne à chaque déclenchement (comme spécifié pour le "-X ARM" générique).
- `isStationary(s)` = `s.stationary || s.iceCageStacks >= 2` ; `isKnockedDownOrStationary(s)` = `s.knockedDown || isStationary(s)` — c'est cette dernière fonction qui détermine l'auto-hit en mêlée et le plafond de DEF à 5, exactement la même logique pour Knockdown et Stationary (ils ne sont distingués que parce que Trash/Shatter doivent pouvoir les différencier).
- `effectiveDef(baseDef, s)` : plafonne d'abord la DEF à `DEF_FLOOR = 5` si `s.paralyzed || isKnockedDownOrStationary(s)`, puis soustrait le malus plat cumulé (`iceCageStacks × 2 + shadowbind×3 + blind×4 + flare×2 + weaken×2`) — reproduit la règle "additifs, Paralysis/Knockdown/Stationary comme plancher" validée avec l'utilisateur.

**Éviter l'explosion combinatoire d'une table dense à 9 dimensions de malus (`computeReachableDebuffStates` + `Map<string, ValueTable>`) :**

Ajouter naïvement les 9 dimensions de `DebuffState` à l'ancienne table de valeurs dense `number[boxes][focus][fury]` (déjà utilisée pour Focus/Fury, voir plus bas) l'aurait transformée en table à ~12 dimensions, dont la taille exploserait combinatoirement même pour une poignée d'effets configurés. La clé de la solution : **les transitions de `DebuffState` ne dépendent ni des boîtes restantes, ni des points de Focus/Fury restants** (seul le couplage Tough → Knockdown fait exception, voir ci-dessous), donc l'ensemble des états de malus *réellement atteignables* à chaque étape peut être précalculé **séparément**, une fois, avant le calcul principal :

- `computeReachableDebuffStates(attacks, startsKnockedDown, hasTough)` fait un parcours "avant" (forward) léger : pour chaque attaque, à partir de l'ensemble des états atteignables à l'étape précédente, calcule les états atteignables après une touche non-critique, une touche critique, ou un raté — et ajoute, si `hasTough` est vrai, la variante "Knocked Down" de chaque état candidat (couplage Tough/Knockdown, voir plus bas). Le résultat est volontairement une **sur-approximation** : peu importe qu'un état listé se révèle finalement de probabilité nulle une fois les seuils/auto-hit pris en compte, tant qu'aucun état réellement atteignable n'est jamais oublié.
- Le calcul principal (passe arrière + passe avant, voir plus bas) ne construit alors une table de valeurs `(boxes × focus × fury)` (`ValueTable`, désormais 3D et non plus 4D) que **pour chaque état de malus effectivement retourné par `computeReachableDebuffStates`**, indexée par une clé compacte (`debuffKey(state)`) dans une `Map<string, ValueTable>` — une par étape `k` de la séquence (`valueTables: Map<string, ValueTable>[]`). Le coût reste ainsi proportionnel à ce qui est *réellement atteignable* pour cette séquence précise (en pratique quelques états, bornés par le nombre d'effets persistants réellement configurés), jamais au produit combinatoire des 9 dimensions possibles.
- **Couplage Tough ↔ Knockdown.** Le reste des transitions de malus est indépendant du sous-problème boîtes/Focus/Fury, à une exception près : la règle "survivre à un jet de Tough rend aussi la cible Knocked Down" fait dépendre un changement de `DebuffState` d'un jet de dés qui appartient au sous-problème ressources. `computeReachableDebuffStates` en tient compte en ajoutant systématiquement la variante Knocked Down de chaque état candidat dès que `hasTough` est vrai (que ce jet réussisse ou non n'a pas d'importance pour cette passe de sur-approximation) ; `damageBranches` (voir plus bas) calcule ensuite, au moment voulu, quelle branche (survie-Tough vs autre) obtient réellement quel `DebuffState`.
- **Cache des profils d'attaque (`profileCache` / `profileFor`)** : comme la DEF/ARM/statut effectifs d'une attaque dépendent maintenant du `DebuffState` courant (qui peut varier au sein d'une même étape `k` si plusieurs états de malus sont atteignables à ce point), le profil n'est plus mis en cache seulement par indice d'attaque `k` mais par la clé complète `` `${k}|${usesAutoHit}|${def}|${arm}|${knockedDown}|${isStationary(debuffState)}` `` — le nombre de contextes distincts réellement rencontrés reste faible en pratique (borné par les effets configurés sur la séquence), donc l'énumération de dés (partie coûteuse) n'est jamais refaite pour un contexte déjà vu.

**Pourquoi c'est rapide même à ~10 attaques :**

Le profil d'une attaque (`buildAttackProfile`, la partie qui énumère les dés — coûteuse) ne dépend **pas** du nombre de boîtes restantes de la cible. Il est donc mis en cache par contexte distinct (voir `profileCache` ci-dessus, en pratique un tout petit nombre par séquence), puis réappliqué à moindre coût contre chaque état rencontré. Un test de performance (`engine.spec.ts`) vérifie qu'une séquence de 10 attaques (avec ou sans points de ressource, avec ou sans effets persistants) s'exécute en moins de 2 secondes (en pratique quasi instantané).

**Dépense optimale de Focus/Fury — induction arrière (`valueTables`) :**

La cible peut dépenser, une fois par attaque et après le jet de dégâts, un point de Focus (réduit les dégâts de 5) ou un point de Fury (annule intégralement les dégâts), jamais les deux à la fois. On suppose qu'elle joue **de façon optimale**, ce qui veut dire : maximiser sa probabilité de survivre au **reste de la séquence**, pas seulement réagir au coup en cours. Comme la décision est prise avant de connaître les jets de dés futurs, mais avec une séquence d'attaques connue à l'avance, ce problème se résout par **induction arrière** (programmation dynamique) plutôt que par simulation forward pure :

1. **Passe arrière** : pour chaque attaque `k` (de la dernière à la première) et pour **chaque état de malus atteignable à cette étape** (`debuffStatesPerStep[k]`, voir ci-dessus), on construit une table `valueTables[k].get(debuffKey(state))[boxes][focusLeft][furyLeft]` = probabilité de survivre aux attaques `k..n-1` en jouant optimalement **sachant qu'on est dans cet état de malus**, calculée à partir de `valueTables[k+1]` (déjà connue) et du profil de l'attaque `k` pour ce contexte. Le cas de base `valueTables[n]` vaut 1 partout, pour chaque état de malus atteignable en fin de séquence (plus d'attaque = déjà survécu).
2. Pour chaque état et chaque issue de l'attaque `k`, `bestAction` (dans `sequence.ts`) compare les 3 choix possibles (ne rien dépenser / dépenser Focus / dépenser Fury) et retient celui qui maximise cette valeur de survie future.
3. **Passe avant** : on rejoue exactement la même politique (via les mêmes `valueTables`, déjà calculées) pour produire la distribution d'états réelle et les statistiques affichées (`hitChance`, `destroyChanceAtThisStep`, etc.).

**Départage des égalités.** Comparer uniquement "probabilité de survie du reste de la séquence" peut faire naître des égalités strictes (ex. la cible est de toute façon condamnée quelle que soit la décision, ou plus aucune attaque future ne dépend du nombre exact de boîtes restantes). Une comparaison naïve (`>` strict) résoudrait alors systématiquement ces égalités vers "ne rien dépenser", ce qui se traduit par un comportement contre-intuitif (la cible refuse de se défendre sur le coup en cours alors que cela ne lui coûterait rien). `bestAction` utilise donc un score **lexicographique à 3 niveaux** (voir `outcomeScore`/`isBetterScore`) : (1) probabilité de survie du reste de la séquence — le vrai objectif ; (2) à égalité, probabilité de survivre **à ce coup précis** ; (3) à égalité sur les deux, nombre de boîtes préservées. Ce n'est qu'en cas d'égalité totale sur les 3 niveaux que le point n'est pas dépensé (comportement par défaut : conserver la ressource).

**Résultat retourné (`SequenceResult`)** :
- `steps[]` : pour chaque attaque, `hitChance`, `critChance` et `averageDamage` (les trois conditionnels à la cible encore vivante à ce moment de la séquence - mêmes accumulateurs `hitMass`/`critMass`/`damageMass` que la boucle de simulation forward existante, juste normalisés par `aliveMass`), ainsi que `destroyChanceAtThisStep` (probabilité de destruction *exactement* à cette étape), `cumulativeDestroyChance`, `expectedBoxesRemaining`. `averageDamage` est le dégât **brut** du jet (dés + POW − ARM), avant toute mitigation Focus/Fury - une propriété de l'attaque, pas de l'état de la cible à cet instant (ces deux derniers champs, avec `destroyChanceAtThisStep`/`cumulativeDestroyChance`, restent calculés en interne mais ne sont plus affichés dans la pop-up Details - voir doc fonctionnelle).
- `finalDestroyChance` : probabilité totale de destruction sur l'ensemble de la séquence.
- `survivalDistribution` : distribution des boîtes restantes, conditionnelle à la survie de la cible.

**Garde-fou** : `focusPoints`/`furyPoints` sont plafonnés à 10 (`MAX_RESOURCE_POINTS`) — au-delà, `computeSequenceOdds` lève une erreur plutôt que de construire une table de valeurs disproportionnée. L'UI clampe silencieusement la saisie dans cette plage avant d'appeler le moteur.

**`SequenceTarget.def: number | 'KD'`.** Si `def === 'KD'`, la cible commence toute la séquence Knocked Down. C'est géré en réutilisant **exactement** le mécanisme déjà en place pour un Knockdown déclenché en cours de séquence :
- `startsKnockedDown` (booléen, `target.def === 'KD'`) sert uniquement à initialiser le `DebuffState` du tout premier pas (backward et forward) à `{ ...INITIAL_DEBUFFS, knockedDown: true }` au lieu de `INITIAL_DEBUFFS` - la logique `isKnockedDownOrStationary` (mêlée uniquement) qui décide de l'auto-hit à chaque étape est totalement inchangée et ne sait même pas si la cible a démarré à terre ou l'est devenue en cours de route.
- `baseDef` retombe sur `DEF_FLOOR` (5, au lieu d'une valeur factice jamais lue) quand `def === 'KD'`, puisque les attaques de tir/magie en ont réellement besoin pour leur jet normal contre la DEF au sol.

**`AttackRow.pow: number | '-'`** (composant UI) : `'-'` représente une attaque qui ne fait jamais de dégâts (mais peut toujours critiquer, un effet critique comme Knockdown restant possible). Traduit en `NO_DAMAGE_POW = -9999` avant d'atteindre le moteur (`resolvePow` dans `odds-calculator.ts`) — un POW aussi négatif garantit `max(0, dés + pow - arm) === 0` quels que soient les dés ou l'ARM, sans qu'aucun changement du moteur ne soit nécessaire.

### `odds-engine.ts` — pont avec Angular

`@Injectable({ providedIn: 'root' })` — expose `compute()` (attaque unique) et `computeSequence()` (séquence complète) aux composants via injection de dépendances. Ne contient aucune logique : c'est uniquement un point d'entrée DI, qui laisse la porte ouverte à du cache ou des profils sauvegardés plus tard sans toucher au moteur.

## Le composant UI (`src/app/odds-calculator/`)

Composant standalone (`OddsCalculator`), `ChangeDetectionStrategy.OnPush`, entièrement piloté par des **signals** Angular (recalcul automatique, aucun bouton "calculer").

### Modèle de données du formulaire

- **Cible partagée** (`targetDef`, `targetArm`, `targetBoxes`, `tough`, `toughOn`, `targetFocus`, `targetFury`) : signals simples au niveau du composant, affichés sur une seule ligne (`.target-row`).
- **Séquence d'attaques** (`rows: WritableSignal<AttackRow[]>`) : chaque ligne (`AttackRow`) est un objet dont **chaque champ est lui-même un signal**. Pas de nom d'attaquant ni de libellé éditable : le libellé affiché dans les résultats (`Attack N`) est généré à partir de la position de la ligne. Champs de base : `type`, `stat`, `diceCount`, `forceAutoHit`, `pow`, `damageDiceCount`. Champs d'effets (voir "Pop-ups" plus bas pour leur usage) :
  - Général : `jumpTheShark` (booléen) - un seul signal pour l'attaque ET les dégâts (voir plus bas).
  - Jet pour toucher : `discardAttackLowest`/`discardAttackHighest` (booléens indépendants, peuvent être vrais tous les deux), `rerollAttack` (booléen), `sanguineFate` (booléen).
  - Jet de dégâts : `discardDamageLowest`/`discardDamageHighest` (booléens indépendants), `rerollDamage`, `trash`, `shatter` (booléens).
  - Crit uniquement : `brutalDamage` (booléen).
  - Effets déclenchables sur touche/critique : `triggerEffects: TriggerEffectRow[]` - voir ci-dessous.

  **`TriggerEffectRow` : un ensemble FIXE plutôt qu'une liste dynamique.** Contrairement à une première version qui gérait les effets persistants comme une liste `WritableSignal<StatEffectRow[]>` extensible (bouton "+ Add effect", suppression par `id`), la version actuelle donne à chaque ligne un tableau `triggerEffects` de taille fixe et connue à l'avance - un `TriggerEffectRow` par clé de `TRIGGER_EFFECT_KEYS` (`'armorPiercing' | 'decapitation' | StatEffectType`, 11 entrées), créé une fois par `createTriggerEffects()` et jamais recréé pendant la vie de la ligne :
    ```ts
    interface TriggerEffectRow {
      readonly key: TriggerEffectKey;
      readonly trigger: WritableSignal<EffectTrigger | 'off'>;
      readonly amount: WritableSignal<number>; // uniquement lu pour 'armPenalty'
    }
    ```
    Puisque chaque effet a un slot fixe, plus besoin de logique d'ajout/suppression avec identifiants : la pop-up Effects se contente d'itérer sur ce tableau et de basculer `trigger` entre `'off'`, `'hit'` et `'crit'`. `toggleTriggerEffect(effect, trigger)` implémente le comportement "bouton toggle" : cliquer le bouton du trigger déjà actif repasse l'effet à `'off'` ; cliquer l'autre trigger y bascule directement (jamais besoin d'éteindre explicitement avant de rallumer sur l'autre déclencheur - un effet n'a jamais les deux triggers actifs en même temps, conformément à la règle "un effet, un déclencheur").

  **Pourquoi cette structure et pas un simple tableau d'objets JS ?** Avec les signals Angular, muter un objet imbriqué dans un tableau signal ne déclenche pas de recalcul (le signal ne détecte que le remplacement de sa propre valeur). Deux options : (a) cloner tout le tableau à chaque frappe clavier, ou (b) donner à chaque champ son propre signal, que `computed()` lira individuellement et pourra donc suivre finement. L'option (b) est retenue ici : ajouter/retirer une **ligne d'attaque** remplace le tableau `rows` (`rows.update(...)`), mais éditer un effet (fixe) ou tout autre champ ne touche que son propre signal — pas de clonage profond nécessaire, et plus aucun tableau interne mutable une fois `triggerEffects` créé.

- **`diceCount` / `damageDiceCount`** : l'utilisateur choisit directement le **nombre total** de dés lancés (2 par défaut), pas un nombre de dés de boost. `toBoostDice(diceCount)` fait la conversion (`max(0, diceCount - 2)`) au moment de construire l'objet `SequencedAttack` envoyé au moteur, qui raisonne en base 2d6 + boost. `discardModifier(lowest, highest)` traduit la paire de booléens vers `{ highest?: 1, lowest?: 1 } | undefined` (toujours au plus un dé par extrémité — aucun effet du jeu n'en défausse plus d'un par côté, mais les deux côtés peuvent être actifs ensemble, voir `dice-pool.ts`).
- `sequencedAttacks` (computed, annoté explicitement `computed<SequencedAttack[]>` avec un retour de callback `.map((r, i): SequencedAttack => ({...}))`) : projette `rows()` vers `SequencedAttack[]` (le type attendu par le moteur), génère le libellé `Attack ${i+1}` à partir de l'index, convertit `pow` via `resolvePow`, applique `r.jumpTheShark()` à la fois à `modifiers.treatOnesAsSixes` et `damageModifiers.treatOnesAsSixes`, assemble `effects: { brutalDamageDice, armorPiercing, decapitation, trash, shatter }` (via `triggerOf(row, key)` pour lire le trigger d'un effet donné dans `triggerEffects` et transformer `'off'`/absent en `undefined`) et `statEffects: StatEffect[]` en filtrant `triggerEffects` sur `isStatEffectKey(key) && trigger !== 'off'`.

  **Piège TypeScript évité : le vérificateur de "propriétés en excès" ne s'applique pas à un littéral objet retourné par une callback `.map()` sans annotation de type explicite sur cette callback**, même si le `computed(...)` englobant porte un type générique explicite. Un ancien champ renommé/supprimé (`criticalEffects`, remplacé par `effects`/`statEffects`) était donc resté silencieusement accepté par le compilateur dans un littéral `{ ...criticalEffects: {...} }` alors que `SequencedAttack` ne l'avait plus - la valeur était simplement ignorée à l'exécution. Corrigé en annotant explicitement le type de retour de la callback (`(r, i): SequencedAttack => ({...})`), ce qui réactive la vérification stricte. À retenir pour tout futur champ ajouté/renommé sur `SequencedAttack`.
- `sequence` (computed) : appelle `engine.computeSequence(...)` — recalculé automatiquement dès qu'un signal lu à l'intérieur change (cible ou n'importe quel champ, y compris chaque `trigger`/`amount` de `triggerEffects`, de n'importe quelle ligne).
- `effectsSummary(row): string[]` : construit la liste de libellés courts ("Discard highest (atk)", "Trash", "Ice Cage (crit)"...) affichée sous chaque ligne d'attaque, à partir de tous les champs d'effets actifs de la ligne (booléens simples, puis un tour de `triggerEffects` en ignorant les entrées à `'off'`).
- `resetEffects(row)` : remet à zéro tous les champs d'effets de la ligne (`forceAutoHit`, chaque booléen, et `trigger.set('off')`/`amount.set(2)` pour chaque `TriggerEffectRow`) — les champs "de base" (type, stat, dés, POW) ne sont volontairement pas touchés, seul le bouton "✕" de la ligne entière les réinitialiserait.

### Champs numériques en `<select>` plutôt qu'en `<input type="number">`

Tous les champs à plage connue (DEF, ARM, Boxes, Focus, Fury, MAT/RAT/AAT, POW, Dice) sont des `<select>` plutôt que des `<input type="number">`, pour que le choix d'une valeur ouvre un sélecteur natif sur mobile plutôt que le clavier. Les listes d'options (`DEF_OPTIONS`, `ARM_OPTIONS`, etc., en tête de `odds-calculator.ts`) sont générées une fois via `range(start, end)`.

Le seuil de réussite de Tough n'est plus configurable (retiré : `toughOn`) - la règle reste toujours 5+, qui est aussi la valeur par défaut de `SequenceTarget.toughOn` côté moteur (`target.toughOn ?? 5`), donc le composant n'a plus besoin de la transmettre du tout.

**Piège à connaître : `<select>` + `ngModel` communique toujours en chaînes de caractères.** Un `<select>` natif ne connaît que des valeurs `value` de type `string` ; `(ngModelChange)` émet donc systématiquement une chaîne, jamais un nombre, même quand `[ngModel]` reçoit un nombre en entrée. Chaque binding reconvertit explicitement : `toNumber(raw)` pour les champs numériques classiques, et `parseDef`/`parsePow` pour DEF/POW qui acceptent en plus une valeur sentinelle (`'KD'`, `'-'`) à ne surtout pas convertir en nombre.

### Actions

- `addAttack()` : ajoute une ligne en clonant les valeurs de la dernière ligne (`cloneAttackRow`, nouveaux signals initialisés à la même valeur - pas de référence partagée avec la ligne source), ou une ligne par défaut (`createAttackRow`) s'il n'y en a pas encore.
- `removeAttack(id)` : retire une ligne (au moins 1 ligne toujours présente).

Pas de bouton pour réordonner les lignes (retiré : voir doc fonctionnelle) - l'ordre se construit uniquement en ajoutant les attaques dans l'ordre voulu.

### Pop-ups (Effects / Details)

Les effets spéciaux par attaque et le détail des résultats (step-by-step, distribution des boîtes restantes) sont déplacés dans des pop-ups plutôt qu'affichés en permanence, pour garder la ligne d'attaque et le résumé des résultats compacts.

Implémentation : élément HTML natif **`<dialog>`** (pas de librairie de modal/CDK) avec `@ViewChild` + `.showModal()` :
- `editingRow: WritableSignal<AttackRow | null>` retient la ligne actuellement éditée ; `openEffects(row)` la renseigne puis ouvre la pop-up, dont le contenu (`@if (editingRow(); as row)`) se lie directement aux signals de cette ligne.
- Une seule pop-up "Effects" est réutilisée pour toutes les lignes (plutôt qu'une pop-up par ligne), et une seule pop-up "Details" pour les résultats.
- `closeOnBackdropClick(event, dialog)` ferme la pop-up au clic en dehors de son contenu : pour un `<dialog>` ouvert en mode modal, un clic sur le `::backdrop` remonte un événement `click` dont la `target` est l'élément `dialog` lui-même (pas un enfant) — cette propriété permet de distinguer "clic sur le fond" de "clic à l'intérieur du contenu" sans `stopPropagation()`. La touche Échap ferme nativement la pop-up sans code additionnel.

**Contenu de la pop-up Effects**, organisé en boutons "toggle" (`.toggle-btn` / `.toggle-btn--active`, voir CSS plus bas) regroupés en sections (voir doc fonctionnelle pour le détail de chaque effet) :
- Auto-hit (un seul bouton, en tête, hors de toute section).
- "General" : Jump the Shark (un seul bouton pour `row.jumpTheShark`, qui pilote à la fois le jet pour toucher et le jet de dégâts).
- "Attack" : Discard lowest, Discard highest, Reroll, Sanguine Fate — chaque bouton bascule un booléen indépendant (`(click)="row.discardAttackLowest.set(!row.discardAttackLowest())"`), donc Discard lowest et Discard highest peuvent être actifs ensemble sans logique de coordination particulière.
- "Damage" : Discard lowest, Discard highest, Reroll, Trash, Shatter — même principe côté dégâts.
- "On hit" : un bouton par entrée de `row.triggerEffects` (`@for (effect of row.triggerEffects; track effect.key)`), actif quand `effect.trigger() === 'hit'`, `(click)="toggleTriggerEffect(effect, 'hit')"`.
- "On crit" : la même boucle sur `row.triggerEffects`, actif quand `effect.trigger() === 'crit'`, plus un bouton dédié pour Brutal Damage (booléen simple, hors de `triggerEffects` puisqu'il n'a pas de variante "On hit").
- Amount pour `-X ARM` : `@let armPenalty = armPenaltyEffect(row);` puis `@if (armPenalty.trigger() !== 'off')` affiche un `<select>` classique (pas un bouton toggle - c'est un montant, pas un booléen) lié à `armPenalty.amount`. `armPenaltyEffect(row)` fait un `.find(e => e.key === 'armPenalty')` sur le tableau fixe - toujours présent, d'où le `!` non-null dans sa signature de retour.
- "Reset" (`resetEffects(row)`) et "Done" (`closeEffects()`) côte à côte en pied de pop-up (`.dialog__actions`, `flex: 1 1 0` chacun).

**Les boutons d'une même catégorie sont dans un conteneur `flex-wrap: wrap` (`.toggle-group`)**, plutôt que `nowrap` comme les lignes Target/Attack : contrairement à ces dernières (nombre de champs fixe et connu), le nombre d'effets actifs sur une attaque est ouvert, donc la pop-up doit pouvoir accueillir n'importe quelle combinaison en passant à la ligne, sans jamais élargir le `<dialog>` (dont la largeur reste plafonnée par `width: min(90vw, 480px)`, inchangée).

`cloneAttackRow` clone aussi `row.triggerEffects` (via `cloneTriggerEffects`, qui crée un nouveau tableau de nouveaux `TriggerEffectRow` avec des signals frais mais les mêmes valeurs) plutôt que de partager les mêmes objets entre la ligne source et la copie créée par "+ Add attack".

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

- **Édition de règles ciblée : Warmachine MK4** (choix utilisateur). Les mécaniques de base (2d6, boost, double = critique, Tough) sont considérées stables et communes aux éditions ; les effets nommés spécifiques sont implémentés avec la formulation la plus largement admise, mais restent à vérifier/ajuster face au livre de règles MK4 exact — voir doc fonctionnelle pour le détail des hypothèses.
- **Ordre des attaques dans une séquence : défini par l'utilisateur**, pas d'optimisation automatique (décision produit assumée, voir doc fonctionnelle pour la justification et les limites).
- **Effets : liste courte et exacte plutôt qu'un système générique** — extensible dans `AttackEffects`/`RollModifiers` (`attack-model.ts`) et `StatEffect`/`StatEffectType` (`sequence.ts`) au fur et à mesure que de nouvelles règles sont confirmées, mais toujours un ensemble fermé et nommé de cas plutôt qu'un moteur d'expressions arbitraires.
- **Relance (reroll) : politique optimale fixe, aucun seuil configurable côté UI** — relancer un jet pour toucher raté, ou un jet de dégâts sous la moyenne, maximise mathématiquement le résultat espéré ; demander un seuil au joueur n'aurait apporté aucune flexibilité utile pour un coût de complexité d'interface.
- **Malus de cible persistants : état minimal typé (`DebuffState`) + précalcul des états atteignables, plutôt qu'une table dense multi-dimensionnelle** — voir `computeReachableDebuffStates` dans `sequence.ts` : le nombre de dimensions de malus (9) rendait une table dense combinatoirement intraitable, alors que le nombre d'états *réellement* atteignables pour une séquence donnée reste faible en pratique. Ce choix garde le calcul exact (aucune approximation sur le résultat final, seulement une sur-approximation sûre de l'ensemble des états à considérer).
- **Dépense de Focus/Fury par la cible : optimale via induction arrière, pas un simple réflexe "je dépense si ce coup me tuerait sinon"** — pertinent car un point peut valoir mieux dépensé plus tôt (pour préserver des boîtes utiles à la survie d'un coup futur) que gardé "au cas où". Le calcul reste exact (pas d'heuristique), au prix d'une table de valeurs par attaque et par état de malus atteignable plutôt que d'une simple règle locale.
- **Shred volontairement non implémenté** : nécessiterait de cloner et insérer dynamiquement une attaque dans la séquence pendant le calcul lui-même (une attaque de Shred peut redéclencher un nouveau Shred), ce qui change la nature du problème (la séquence n'est plus figée à l'avance) — reporté à une prochaine itération plutôt que précipité dans l'architecture actuelle.
