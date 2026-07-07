# ChanceMachine — Documentation fonctionnelle

## Objectif

ChanceMachine est un calculateur de probabilités pour les jeux de figurines **Warmachine / Hordes**. Il répond à la question qu'un joueur se pose en préparant son tour : *"si j'enchaîne ces attaques dans cet ordre, quelle est ma chance de détruire cette cible ?"*

C'est le successeur d'**OddsMachine**, une application Android qui n'est plus disponible/fonctionnelle sur les smartphones récents. ChanceMachine reprend le même besoin sous forme de PWA (Progressive Web App), installable sur Android **et** iOS, sans passer par un store.

Édition de règles ciblée : **Warmachine MK4**.

## Pour qui ?

La communauté de joueurs Warmachine/Hordes, internationale — c'est pourquoi l'interface est en anglais.

## Ce que l'application calcule

À partir :
- d'une **cible unique** (DEF, ARM, boîtes de dégâts restantes, Tough ou non),
- d'une **séquence d'attaques ordonnée** (un ou plusieurs attaquants, chacun avec une ou plusieurs attaques),

l'application calcule, par **énumération exacte** des jets de dés (pas d'approximation ni de simulation aléatoire) :
- la chance de toucher de chaque attaque de la séquence,
- la chance de détruire la cible à *chaque étape* de la séquence,
- la chance cumulée de détruire la cible après N attaques,
- le nombre de boîtes restantes espéré si la cible survit,
- la distribution complète des boîtes restantes en cas de survie.

Les résultats se recalculent **instantanément** à chaque modification d'un champ, sans bouton "Calculer".

## Écran principal

L'écran se divise en trois zones empilées verticalement : **Target** en haut, **Attack sequence** au milieu, **Results** tout en bas. Le titre, Target et Results sont **fixes à l'écran** (Results reste collé en bas) ; seule la partie Attack sequence défile verticalement si la séquence contient beaucoup d'attaques, sans faire bouger le reste de l'écran.

Tous les champs numériques sont des **listes déroulantes** (`<select>`) plutôt que des champs de saisie libre — sur mobile, ça ouvre un sélecteur natif au lieu du clavier, ce qui est nettement plus rapide pour choisir une valeur dans une plage connue à l'avance. Les valeurs sont centrées dans chaque champ, avec un espacement généreux entre les champs. Le Target et chaque ligne d'attaque tiennent sur **une seule ligne, y compris sur mobile** ; si un écran est vraiment trop étroit pour tout afficher, la ligne défile horizontalement plutôt que de passer à la ligne suivante — sans barre de défilement visible (pour ne pas empiéter sur les chiffres), le défilement au doigt/trackpad reste possible.

### 1. Target (cible)

Une seule ligne de champs, partagée par toute la séquence d'attaques :
- **DEF** : `KD` (la cible est Knocked Down / incapable de se défendre dès le début de la séquence — **toutes** les attaques, quel que soit leur type, touchent alors automatiquement), puis de 5 à 25.
- **ARM** : de 1 à 35.
- **Boxes** (capacité de dégâts restante) : de 1 à 99.
- **Focus** / **Fury** : de 0 à 15 (voir "Focus et Fury" plus bas).
- Une case à cocher **Tough** — réussit toujours sur 5+, il n'y a pas de seuil configurable.

### 2. Attack sequence (séquence d'attaques)

Liste ordonnée de lignes "attaque". Chaque ligne représente **une attaque** et porte :
- Un numéro d'ordre, et le bouton **✕** (supprimer, au moins une attaque reste toujours présente). Il n'y a pas de bouton pour réordonner les lignes : l'ordre se construit en ajoutant les attaques dans l'ordre voulu.
- **Type** : `melee` / `ranged` / `arcane` — détermine si un **Knockdown** déclenché plus tôt dans la séquence profite à cette attaque (voir plus bas), et change le label du champ suivant.
- **MAT / RAT / AAT** (le libellé s'adapte au type choisi) : de 0 à 20.
- **Dice** : nombre total de dés lancés pour toucher, de 1 à 6 (2 par défaut ; le joueur choisit directement ce nombre pour représenter un boost plutôt que de saisir un nombre de dés de boost séparément).
- **POW** : `-` (l'attaque ne fait aucun dégât — utile pour une attaque dont le seul but est un effet critique comme Knockdown ; un critique reste possible puisque le jet pour toucher a bien lieu), puis de 0 à 30.
- **Dice** (deuxième occurrence) : nombre total de dés lancés pour les dégâts, de 1 à 6.
- **Effects** : bouton qui ouvre une pop-up regroupant les effets spéciaux de cette attaque — un point apparaît sur le bouton dès qu'au moins un effet est actif. Contenu de la pop-up :
  - **Auto-hit (target Stationary)** : force la réussite automatique du jet pour toucher, indépendamment de DEF.
  - **Crit: Knockdown** : si cette attaque inflige un critique (double au jet pour toucher), la cible devient *Knocked Down* pour le **reste de la séquence**.
  - **Crit: Brutal Damage (extra dice)** : nombre de dés supplémentaires ajoutés au jet de dégâts, **uniquement** si l'attaque est critique.

Le bouton **"+ Add attack"** ajoute une nouvelle attaque en bas de liste, en **recopiant les valeurs de la dernière attaque de la liste** (type, stats, dés, effets) — le cas le plus courant étant d'enchaîner des attaques similaires, il suffit d'ajuster les quelques champs qui changent plutôt que de tout ressaisir.

**L'ordre des lignes est l'ordre de résolution.** L'application ne cherche pas automatiquement le meilleur ordre possible : c'est un choix assumé (voir "Choix produit" ci-dessous) — c'est au joueur de définir l'ordre qu'il compte jouer, comme il le ferait à la table.

### 3. Results (résultats)

Par défaut, seuls deux chiffres sont affichés :
- **Chance to destroy** : probabilité totale de détruire la cible sur l'ensemble de la séquence.
- **Expected boxes left** : espérance du nombre de boîtes restantes après la dernière attaque (0 si détruite).

Le bouton **"Show details"** ouvre une pop-up avec le détail complet :
- **Step by step** : pour chaque attaque de la séquence, dans l'ordre : *Hit* (chance de toucher), *Crit* (chance de critique, un double au jet pour toucher), *Avg damage* (dégâts moyens infligés par le jet de dégâts de cette attaque, dés + POW − ARM). Les trois sont conditionnels au fait que la cible soit encore vivante à ce moment de la séquence, et ne tiennent pas compte d'une éventuelle mitigation Focus/Fury (ce sont des propriétés de l'attaque elle-même, pas de l'issue de la séquence).
- **Boxes remaining if it survives** : histogramme de la distribution des boîtes restantes, conditionnelle au fait que la cible ait survécu à toute la séquence. Si la cible est détruite dans 100% des cas, un message l'indique à la place du graphique.

## Règles modélisées

- Jet pour toucher : 2d6 + boosts éventuels ≥ (DEF − MAT/RAT).
- Double sur le jet pour toucher = critique.
- Jet de dégâts : 2d6 + boosts éventuels + POW − ARM (minimum 0).
- **Tough** : à chaque fois que des dégâts seraient létaux, un jet de Tough est tenté ; en cas de réussite, la cible survit avec 1 boîte restante et devient Knocked Down (comportement standard de la règle Tough) plutôt que d'être détruite.
- **Knockdown** (effet critique) : persiste pour le reste de la séquence une fois déclenché. Seules les attaques de **mêlée** ultérieures dans la séquence touchent automatiquement une cible Knocked Down ; les attaques de **tir** et de **magie** n'en tirent aucun bénéfice dans le modèle actuel.
- **Brutal Damage** (effet critique) : dés de dégâts supplémentaires, mais uniquement sur la branche critique du jet (une attaque qui touche sans critique n'en bénéficie pas).
- **Auto-hit** (cible Stationary ou équivalent, `Effects > Auto-hit`, ou `DEF: KD`) : aucun jet pour toucher n'est effectué, donc un auto-hit ne peut jamais produire de critique (pas de dés de toucher lancés = pas de double possible).
- **DEF: KD** (cible Knocked Down dès le début de la séquence) diffère du Knockdown déclenché en cours de séquence par un critique : `DEF: KD` fait toucher automatiquement **toutes** les attaques de la séquence, quel que soit leur type (mêlée, tir, magie), alors qu'un Knockdown déclenché par un critique ne profite qu'aux attaques de **mêlée** qui suivent (voir ci-dessus). C'est un raccourci pour "la cible ne peut absolument pas se défendre pendant toute la séquence", pas juste un état Knocked Down normal.

### Focus et Fury (points de ressource de la cible)

Si la cible dispose de points de **Focus** et/ou de **Fury** (champs de la section Target), elle peut en dépenser **au plus un par attaque**, **après le jet de dégâts** de cette attaque :
- **1 point de Focus** réduit les dégâts de cette attaque de 5 (plancher à 0).
- **1 point de Fury** annule intégralement les dégâts de cette attaque (dans le jeu : transfert vers une warbeast — ici simplifié en "dégâts ignorés").

Ces points sont supposés **dépensés de façon optimale** par la cible. "Optimale" signifie ici : l'application calcule, en remontant toute la séquence d'attaques depuis la fin (induction arrière), la politique de dépense qui maximise la probabilité de survie de la cible sur l'ensemble de la séquence — pas seulement une réaction "je dépense si ce coup-ci serait autrement fatal". Concrètement, cela permet à l'application de reconnaître qu'il peut parfois valoir mieux mitiger un coup non-fatal maintenant (pour préserver des boîtes utiles plus tard) plutôt que de garder le point pour un coup futur.

En cas d'égalité stricte entre plusieurs choix vis-à-vis de cet objectif (ex. la cible est de toute façon condamnée quelle que soit la décision), l'application privilégie, dans l'ordre : survivre à l'attaque en cours, puis préserver le plus de boîtes restantes — plutôt que de "gâcher" arbitrairement un point sans aucun bénéfice, ni à l'inverse refuser de s'en servir alors que cela ne coûte rien.

## Hypothèses à vérifier (édition MK4)

Certains points de règles ont été implémentés selon la formulation la plus communément admise à travers les éditions de Warmachine/Hordes, faute de certitude absolue sur la formulation exacte en MK4 (édition récente, 2023) :
- Le fait que **seule la mêlée** bénéficie de l'auto-hit sur cible Knocked Down (pas de bonus/malus chiffré pour le tir/la magie contre une cible à terre).
- Le comportement de Tough (survie à 1 boîte + Knocked Down).

**À vérifier avec le livre de règles MK4** et à corriger si besoin — ce sont des hypothèses de modélisation, pas des règles copiées du livre.

## Ce qui n'est pas encore implémenté

- **Effets critiques nommés au-delà de Knockdown et Brutal Damage** (Decapitation, Sustained Attack, etc.) : liste volontairement reportée à une prochaine itération, en attente de la liste exacte et de la formulation précise de ces règles (fournie par l'utilisateur).
- **Optimisation automatique de l'ordre des attaques** : décision produit — l'ordre reste défini manuellement par l'utilisateur (voir "Choix produit").
- Gestion des unités (plusieurs modèles identiques dans une même attaque de groupe) — non traitée, le moteur raisonne modèle par modèle.

## Choix produit (validés avec l'utilisateur)

- **Édition de règles : MK4** — plutôt que MK2/MK3, en cohérence avec l'édition actuellement jouée par la communauté.
- **Ordre des attaques défini par l'utilisateur**, plutôt qu'une optimisation automatique : plus simple à utiliser, correspond à la façon dont un joueur planifie réellement son tour (il sait déjà dans quel ordre il compte jouer ses attaques), et évite l'explosion combinatoire d'une recherche exhaustive sur l'ordre à mesure que le nombre d'attaques augmente.
- **Effets critiques : liste courte et exacte plutôt qu'un système générique** configurable "à la carte" — priorité à la justesse des règles implémentées sur la couverture large mais approximative.

## Feuille de route

- Recueillir la liste exacte des effets critiques/spéciaux à ajouter (Decapitation et autres) avec leur formulation précise.
- Icônes et configuration finale du manifest PWA.
- Vérification de l'affichage sur smartphone (en cours).
