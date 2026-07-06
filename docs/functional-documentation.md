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

L'écran se divise en trois zones :

### 1. Target (cible)

Caractéristiques de la cible visée, partagées par toute la séquence d'attaques :
- **DEF**, **ARM**
- **Boxes remaining** : capacité de dégâts restante avant destruction
- **Tough** : case à cocher ; si activée, un champ **"Tough succeeds on"** apparaît (valeur du d6 à partir de laquelle le jet de Tough réussit — 5 par défaut, correspond à une réussite sur 5 ou 6)

### 2. Attack sequence (séquence d'attaques)

Liste ordonnée de cartes "attaque". Chaque carte représente **une attaque** et porte :
- **Nom de l'attaquant** (éditable en tête de carte) — permet de regrouper visuellement les attaques d'un même modèle quand plusieurs attaquants sont impliqués.
- **↑ / ↓** : réordonner l'attaque dans la séquence.
- **✕** : supprimer l'attaque (au moins une attaque reste toujours présente).
- **Attack label** : libellé libre (ex. "Weapon Master swing", "Focus-boosted spell").
- **Type** : `melee` / `ranged` / `arcane` — détermine si un **Knockdown** déclenché plus tôt dans la séquence profite à cette attaque (voir plus bas).
- **MAT / RAT** : caractéristique de tir/mêlée utilisée pour le jet pour toucher.
- **Boost (to hit)** : nombre de dés de boost ajoutés au jet pour toucher (0 à 4).
- **Auto-hit (target Stationary)** : force la réussite automatique du jet pour toucher (cible Stationary, ou toute autre raison de toucher automatiquement), indépendamment de DEF.
- **POW** : puissance de l'arme/du sort.
- **Boost (damage)** : dés de boost ajoutés au jet de dégâts.
- **Crit: Knockdown** : si cette attaque inflige un critique (double au jet pour toucher), la cible devient *Knocked Down* pour le **reste de la séquence**.
- **Crit: Brutal Damage (extra dice)** : nombre de dés supplémentaires ajoutés au jet de dégâts, **uniquement** si l'attaque est critique.

Le bouton **"+ Add attack"** ajoute une nouvelle attaque en bas de liste (le nom d'attaquant de la dernière carte est repris par défaut, pour enchaîner rapidement plusieurs attaques du même modèle).

**L'ordre des cartes est l'ordre de résolution.** L'application ne cherche pas automatiquement le meilleur ordre possible : c'est un choix assumé (voir "Choix produit" ci-dessous) — c'est au joueur de définir l'ordre qu'il compte jouer, comme il le ferait à la table.

### 3. Results (résultats)

- **Chance to destroy** : probabilité totale de détruire la cible sur l'ensemble de la séquence.
- **Expected boxes left** : espérance du nombre de boîtes restantes après la dernière attaque (0 si détruite).
- **Step by step** : tableau détaillant, pour chaque attaque de la séquence, dans l'ordre :
  - *Hit* : chance de toucher, **sachant que la cible est encore vivante** à ce moment de la séquence.
  - *Destroy (step)* : probabilité que la cible soit détruite **exactement** à cette attaque (pas avant, pas après).
  - *Cumulative* : probabilité que la cible soit détruite par cette attaque ou une précédente.
- **Boxes remaining if it survives** : histogramme de la distribution des boîtes restantes, conditionnelle au fait que la cible ait survécu à toute la séquence. Si la cible est détruite dans 100% des cas, un message l'indique à la place du graphique.

## Règles modélisées

- Jet pour toucher : 2d6 + boosts éventuels ≥ (DEF − MAT/RAT).
- Double sur le jet pour toucher = critique.
- Jet de dégâts : 2d6 + boosts éventuels + POW − ARM (minimum 0).
- **Tough** : à chaque fois que des dégâts seraient létaux, un jet de Tough est tenté ; en cas de réussite, la cible survit avec 1 boîte restante et devient Knocked Down (comportement standard de la règle Tough) plutôt que d'être détruite.
- **Knockdown** (effet critique) : persiste pour le reste de la séquence une fois déclenché. Seules les attaques de **mêlée** ultérieures dans la séquence touchent automatiquement une cible Knocked Down ; les attaques de **tir** et de **magie** n'en tirent aucun bénéfice dans le modèle actuel.
- **Brutal Damage** (effet critique) : dés de dégâts supplémentaires, mais uniquement sur la branche critique du jet (une attaque qui touche sans critique n'en bénéficie pas).
- **Auto-hit** (cible Stationary ou équivalent) : aucun jet pour toucher n'est effectué, donc un auto-hit ne peut jamais produire de critique (pas de dés de toucher lancés = pas de double possible).

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
