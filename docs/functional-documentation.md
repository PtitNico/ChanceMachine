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
- **DEF** : `KD` (la cible est Knocked Down dès le début de la séquence — les attaques de **mêlée** touchent alors automatiquement pour toute la séquence, mais les attaques de **tir** et de **magie** continuent de lancer un jet normal contre une DEF de 5), puis de 5 à 25.
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
- **Effects** : bouton qui ouvre une pop-up regroupant les effets spéciaux de cette attaque — un point apparaît sur le bouton dès qu'au moins un effet est actif. Une fois la pop-up fermée, un **résumé compact** des effets actifs de cette attaque s'affiche en petit **sous la ligne** (ex. `Discard highest (atk)`, `Trash`, `Ice Cage (crit)`), pour garder une vue d'ensemble de la séquence sans rouvrir chaque pop-up.

  Chaque effet de la pop-up est un **bouton "toggle" à bords arrondis** : gris/inactif par défaut, il se colore (fond brass) dès qu'il est activé — un simple clic l'active ou le désactive, sans passer par une case à cocher ou un menu déroulant. Les boutons sont regroupés par catégorie, chaque catégorie s'affichant sur sa propre ligne qui **passe à la ligne dès que nécessaire** plutôt que d'élargir la pop-up (le nombre d'effets actifs n'a donc aucun impact sur la largeur de l'application) :
  - **Auto-hit** : bouton isolé en tête de pop-up — force la réussite automatique du jet pour toucher, indépendamment de DEF.
  - **General** : Jump the Shark — s'applique **à la fois** au jet pour toucher et au jet de dégâts (un seul bouton pour les deux, plutôt qu'un réglage séparé par jet).
  - **Attack** (modificateurs du jet pour toucher) : Discard lowest, Discard highest — défausser le plus bas et/ou le plus haut dé avant de sommer ; **les deux peuvent être actifs en même temps** sur le même jet —, Reroll (relance optionnelle si le jet raterait), Sanguine Fate.
  - **Damage** (modificateurs du jet de dégâts) : Discard lowest, Discard highest (même règle : cumulables), Reroll (relance optionnelle si le jet est sous la moyenne), Trash, Shatter.
  - **On hit** / **On crit** : tous les effets déclenchables sur une touche et/ou sur un critique (Armor Piercing, Decapitation, Knockdown, Stationary, Ice Cage, Shadowbind, Blind, Paralysis, Flare, Weaken, "-X ARM") apparaissent dans les deux catégories, une fois chacune. Activer le bouton d'un effet dans "On hit" le déclenche sur toute touche (crit compris) ; l'activer dans "On crit" le réserve au seul critique ; les deux boutons d'un même effet sont mutuellement exclusifs (en activer un désactive l'autre). Brutal Damage n'apparaît que dans "On crit" (il ne peut jamais se déclencher sur une touche normale). Quand **"-X ARM"** est actif (dans l'une ou l'autre catégorie), un sélecteur de montant (1 à 10) apparaît en bas de la pop-up.
  - **Reset** : bouton en bas de la pop-up qui désactive d'un coup tous les effets de cette attaque (y compris Auto-hit), pour repartir d'une ligne "propre" sans les décocher un par un.

Le bouton **"+ Add attack"** ajoute une nouvelle attaque en bas de liste, en **recopiant les valeurs de la dernière attaque de la liste** (type, stats, dés, tous les effets) — le cas le plus courant étant d'enchaîner des attaques similaires, il suffit d'ajuster les quelques champs qui changent plutôt que de tout ressaisir.

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
- **Un jet pour toucher où tous les dés affichent 1 est toujours un échec**, quels que soient MAT/RAT/AAT et DEF.
- **Un jet pour toucher où tous les dés affichent 6 est toujours une réussite** (et donc aussi un critique, puisqu'un jet où tous les dés sont identiques comporte forcément un double), quels que soient MAT/RAT/AAT et DEF — sauf si un seul dé est lancé, auquel cas un simple 6 ne bénéficie d'aucun bonus particulier.
- Jet de dégâts : 2d6 + boosts éventuels + POW − ARM (minimum 0).
- **Tough** : à chaque fois que des dégâts seraient létaux, un jet de Tough est tenté ; en cas de réussite, la cible survit avec 1 boîte restante et devient Knocked Down (comportement standard de la règle Tough) plutôt que d'être détruite.
- **Auto-hit** (`Effects > Auto-hit`, ou cible Knocked Down/Stationary face à une attaque de mêlée, ou `DEF: KD`) : aucun jet pour toucher n'est effectué, donc un auto-hit ne peut jamais produire de critique (pas de dés de toucher lancés = pas de double possible).
- **DEF: KD** (cible Knocked Down dès le début de la séquence) se comporte exactement comme un Knockdown déclenché en cours de séquence (voir ci-dessous), simplement actif dès la première attaque plutôt que déclenché par une attaque : seules les attaques de **mêlée** touchent automatiquement (pour toute la séquence, dès le début) ; les attaques de **tir** et de **magie** lancent un jet normal contre une DEF de 5.

### Effets pris en charge

**Modificateurs de jet** (s'appliquent au jet lui-même, avant de déterminer le résultat) :
- **Discard lowest** / **Discard highest** (attaque et/ou dégâts, indépendamment) : défausse le dé le plus bas et/ou le plus haut avant de sommer. **Les deux peuvent être actifs en même temps** sur le même jet (ex. un jet à 4 dés qui ne garde que les deux dés du milieu).
- **Reroll** (attaque et/ou dégâts) : relance optionnelle unique. Sur le jet pour toucher, l'application relance systématiquement un jet qui **raterait** — c'est mathématiquement toujours au moins aussi bon que de garder le jet initial. Sur le jet de dégâts, elle relance un jet **sous la moyenne** (2d6 → en dessous de 7 typiquement) selon le même principe. Le joueur n'a donc rien à configurer : la case active simplement "relance optimale disponible" pour ce jet.
- **Jump the Shark** : chaque dé montrant un 1 compte comme un 6 à la place — s'applique **à la fois** au jet pour toucher et au jet de dégâts (un seul réglage pour les deux, puisque l'effet en jeu concerne tous les dés lancés par l'attaque).
- **Sanguine Fate** : un dé supplémentaire est lancé sur le jet pour toucher — il ne compte jamais dans la somme, mais peut créer un double (donc un critique) avec n'importe quel autre dé du jet.

**Effets propres à une seule attaque** (ne persistent pas sur la cible) :
- **Brutal Damage** : sur critique, ajoute un dé supplémentaire au jet de dégâts.
- **Armor Piercing** (déclenché sur touche ou sur critique, au choix) : divise par deux l'ARM **de base** de la cible (avant tout malus d'ARM déjà en cours — voir "-X ARM" ci-dessous), arrondi au supérieur, pour le jet de dégâts de cette seule attaque.
- **Decapitation** (déclenché sur touche ou sur critique, au choix) : double les dégâts infligés par cette attaque.
- **Trash** : dé de dégâts supplémentaire si la cible est **actuellement** Knocked Down au moment de cette attaque.
- **Shatter** : dé de dégâts supplémentaire si la cible est **actuellement** Stationary au moment de cette attaque.

**Effets persistants sur la cible** (déclenchés sur touche ou sur critique, au choix par effet ; restent actifs pour **le reste de la séquence** une fois déclenchés — sauf mention contraire) :
- **Knockdown** : la cible devient *Knocked Down*. Seules les attaques de **mêlée** ultérieures en profitent (auto-hit) ; le tir et la magie continuent de lancer un jet normal, mais contre une DEF plafonnée à 5 (voir "Stationary" ci-dessous pour le détail du plafond).
- **Stationary** : se comporte **exactement comme Knockdown** pour le jet pour toucher (auto-hit en mêlée, DEF plafonnée à 5 pour tir/magie) — les deux sont suivis séparément uniquement parce que Trash (Knockdown) et Shatter (Stationary) doivent pouvoir les distinguer.
- **Ice Cage** : −2 DEF, **cumulable** (chaque déclenchement s'ajoute aux précédents). À partir de 2 cumuls, la cible devient également Stationary (donc auto-hit en mêlée), en plus du malus de DEF qui continue de s'additionner.
- **Shadowbind** : −3 DEF.
- **Blind** : −4 DEF.
- **Paralysis** : plafonne la DEF de la cible à 5 (comme Knocked Down/Stationary), et se cumule ensuite avec les autres malus de DEF actifs (Ice Cage, Shadowbind, Blind, Flare, Weaken) exactement comme s'il s'agissait d'un Knockdown.
- **Flare** : −2 DEF.
- **Weaken** : −2 DEF.
- **-X ARM** (générique, montant réglable de 1 à 10) : réduit l'ARM de la cible pour le reste de la séquence, cumulable avec d'autres instances de cet effet. Armor Piercing ignore volontairement ce malus (il repart toujours de l'ARM de base).

Tous les malus de DEF listés ci-dessus sont **additifs** entre eux (Ice Cage, Shadowbind, Blind, Flare, Weaken s'additionnent tous), à l'exception de Knocked Down/Stationary/Paralysis qui **plafonnent d'abord la DEF à 5** avant que les autres malus ne s'y ajoutent (donc potentiellement en dessous de 5 si plusieurs effets sont cumulés). Chaque effet nommé (hors Ice Cage et "-X ARM", explicitement cumulables) ne peut s'appliquer qu'une fois sur une même cible, même s'il est déclenché par plusieurs attaques différentes de la séquence — une deuxième occurrence n'a alors aucun effet supplémentaire.

**Effet réservé pour une prochaine itération : Shred** (attaque gratuite supplémentaire sur critique, avec le même profil que l'attaque qui l'a déclenché) — volontairement pas encore implémenté (voir "Ce qui n'est pas encore implémenté").

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

- **Shred** (attaque gratuite supplémentaire sur critique, même profil que l'attaque qui l'a déclenché, pouvant elle-même redéclencher un nouveau Shred) : reportée à une prochaine itération — c'est le seul effet de la liste fournie par l'utilisateur encore non implémenté.
- **Optimisation automatique de l'ordre des attaques** : décision produit — l'ordre reste défini manuellement par l'utilisateur (voir "Choix produit").
- Gestion des unités (plusieurs modèles identiques dans une même attaque de groupe) — non traitée, le moteur raisonne modèle par modèle.

## Choix produit (validés avec l'utilisateur)

- **Édition de règles : MK4** — plutôt que MK2/MK3, en cohérence avec l'édition actuellement jouée par la communauté.
- **Ordre des attaques défini par l'utilisateur**, plutôt qu'une optimisation automatique : plus simple à utiliser, correspond à la façon dont un joueur planifie réellement son tour (il sait déjà dans quel ordre il compte jouer ses attaques), et évite l'explosion combinatoire d'une recherche exhaustive sur l'ordre à mesure que le nombre d'attaques augmente.
- **Effets : liste courte et exacte plutôt qu'un système générique** configurable "à la carte" — priorité à la justesse des règles implémentées sur la couverture large mais approximative. La liste s'est étoffée (modificateurs de jet, effets propres à une attaque, effets persistants sur la cible) mais reste une liste nommée et fermée, pas un moteur d'effets arbitraires.
- **Relance (Reroll) sans seuil configurable** : plutôt que de demander au joueur de choisir un seuil de relance, l'application applique toujours la politique optimale (relancer un jet pour toucher raté, ou un jet de dégâts sous la moyenne) — évite un champ de configuration supplémentaire pour un résultat mathématiquement équivalent ou meilleur.
- **Malus de DEF additifs, avec Knocked Down/Stationary/Paralysis comme plancher** : les malus nommés (Ice Cage, Shadowbind, Blind, Flare, Weaken) s'additionnent tous entre eux ; Knocked Down/Stationary/Paralysis plafonnent d'abord la DEF à 5 plutôt que de s'additionner comme les autres, ce qui reflète leur formulation en jeu ("DEF réduite à 5" et non "−X DEF").
- **Effets persistants non stackables sauf mention contraire** : un même effet nommé ne peut s'appliquer qu'une fois sur une cible (Ice Cage et le "-X ARM" générique étant les seules exceptions explicitement cumulables), pour rester fidèle à la formulation "sauf si précisé" fournie par l'utilisateur.

## Feuille de route

- Implémenter Shred (attaque gratuite récursive sur critique).
- Icônes et configuration finale du manifest PWA.
- Vérification de l'affichage sur smartphone (en cours).
