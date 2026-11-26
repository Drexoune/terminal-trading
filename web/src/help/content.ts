// Textes d'aide du terminal : une case explicative par page (à quoi sert la page, comment la lire,
// comment s'en servir), une bulle par panneau et un glossaire pour les termes précis. Écrits pour
// quelqu'un qui découvre les marchés ; aucune recommandation d'investissement.

export interface Help { what: string; read?: string; use?: string; calc?: string }
export interface PageHelp { intro: string; read: string[]; use: string[] }

// --- Glossaire (bulles posées à côté d'un libellé) ------------------------------------------------

export const TERMS = {
  restingLiquidity: { what: 'Ordres limites posés dans les carnets et pas encore exécutés : des acheteurs qui attendent un prix plus bas, des vendeurs qui attendent un prix plus haut.', read: 'Plus la bande est dorée et claire, plus il y a de BTC en attente à ce prix. Les 4 nuances correspondent aux paliers indiqués (en BTC).', use: 'Les grosses zones agissent souvent comme des freins : le prix ralentit ou rebondit en les touchant. Si elles disparaissent avant d’être touchées (« mur retiré »), elles étaient peut-être là pour impressionner.' },
  aggressiveBuys: { what: 'Achats « au marché » : l’acheteur accepte le prix du vendeur pour être servi tout de suite. On dit qu’il est preneur (taker).', read: 'Chaque bulle cyan est un achat exécuté ; sa surface est proportionnelle au volume.', use: 'Une rafale de grosses bulles cyan montre une demande pressée. Si le prix ne monte pas malgré elles, des vendeurs passifs absorbent : signe de résistance.' },
  aggressiveSells: { what: 'Ventes « au marché » : le vendeur accepte le prix de l’acheteur pour sortir tout de suite (vendeur preneur).', read: 'Chaque bulle rouge est une vente exécutée ; sa surface est proportionnelle au volume.', use: 'Des ventes agressives massives qui ne font pas baisser le prix signalent des acheteurs passifs qui absorbent : signe de support.' },
  wallPulled: { what: 'Un gros bloc d’ordres qui a disparu du carnet sans être exécuté.', read: 'Marqué sur la carte quand la liquidité au repos baisse fortement à un prix que le marché n’a pas touché.', use: 'Une liquidité qui s’efface à l’approche du prix n’était pas un vrai support ou une vraie résistance. Le terminal ne suppose jamais où sont les stops : il montre seulement ce qui a été observé.' },
  spread: { what: 'Écart entre la meilleure offre de vente et la meilleure demande d’achat.', read: '« Croisés » : une plateforme achète plus cher qu’une autre ne vend ; c’est un écart de prix entre plateformes, normal quelques instants.', use: 'Un spread qui s’élargit signale un marché moins liquide : les ordres au marché coûtent plus cher.' },
  imbalance: { what: 'Différence entre les BTC en attente à l’achat et à la vente sur les 10 niveaux les plus proches du prix.', calc: '(achats − ventes) / (achats + ventes).', read: 'Positif : plus d’acheteurs patients sous le prix ; négatif : plus de vendeurs au-dessus.', use: 'Indice de court terme, très changeant : à croiser avec les achats et ventes agressifs, jamais seul.' },
  cvdPerp: { what: 'CVD des contrats perpétuels (produits à effet de levier) : cumul des achats agressifs moins les ventes agressives, minute par minute.', read: 'La courbe monte quand les preneurs achètent plus qu’ils ne vendent.', use: 'Le perpétuel reflète surtout les spéculateurs à levier.' },
  cvdSpot: { what: 'CVD du marché au comptant (spot) : achats et ventes de vrais BTC, sans levier.', read: 'Même calcul que le perpétuel, sur les plateformes spot.', use: 'Un spot qui achète pendant que le perpétuel vend est souvent jugé plus solide qu’une hausse portée par le seul levier.' },
  cvdDivergence: { what: 'Le spot et le perpétuel vont en sens opposés sur la fenêtre.', calc: 'Signes opposés, chacun au moins 2 % du volume preneur de son marché.', use: 'Indique que deux populations d’acteurs ne sont pas d’accord : à surveiller, la suite tranche souvent dans le sens du spot.' },
  funding: { what: 'Paiement périodique entre acheteurs (longs) et vendeurs (shorts) de contrats perpétuels, pour garder leur prix proche du comptant.', read: 'Positif : les longs paient les shorts (le marché penche à la hausse et paie pour rester long). Négatif : l’inverse. Ramené ici à une période de 8 h pour comparer les plateformes.', use: 'Un funding très positif montre un marché chargé en acheteurs à levier, vulnérable à une baisse qui forcerait leurs liquidations ; très négatif, l’inverse (risque de « short squeeze »).' },
  openInterest: { what: 'Open interest (OI) : nombre total de contrats perpétuels ouverts, en dollars ou en BTC.', read: 'L’OI monte quand de nouvelles positions s’ouvrent, baisse quand elles se ferment ou sont liquidées. « OI 24 h » compte en BTC, donc sans l’effet du prix.', use: 'Prix en hausse + OI en hausse : de nouveaux acheteurs entrent. Prix en hausse + OI en baisse : des vendeurs se rachètent (hausse plus fragile). Une chute brutale de l’OI accompagne souvent une cascade de liquidations.' },
  premium: { what: 'Écart entre le prix du contrat perpétuel (prix de marque) et le prix au comptant (indice).', calc: 'marque / indice − 1.', use: 'Prime positive : le perpétuel est plus cher que le comptant, les acheteurs à levier dominent. Elle annonce souvent le signe du prochain funding.' },
  nextFunding: { what: 'Temps restant avant le prochain paiement du funding sur cette plateforme.' },
  liquidation: { what: 'Fermeture forcée d’une position à levier par la plateforme, quand la perte atteint la marge déposée.', read: '« Long » liquidé : un acheteur forcé de vendre ; « Short » liquidé : un vendeur forcé de racheter. Montant en dollars, prix d’exécution, plateforme.', calc: 'Ce sont les liquidations réellement publiées par Binance, Bybit et OKX, additionnées. Binance et OKX n’en diffusent qu’une par seconde au plus : leurs totaux sont des minimums. Hyperliquid ne publie pas de flux. Jamais de niveaux de liquidation « estimés ».', use: 'Une cascade de longs liquidés accélère la baisse puis la laisse souvent épuisée ; une cascade de shorts accélère la hausse. Les grosses lignes (≥ 10 M$) sont surlignées.' },
  dvol: { what: 'Indice de volatilité de Deribit : la variation annuelle du BTC que le marché des options anticipe sur 30 jours.', read: '50 % signifie qu’un mouvement d’environ ±50 % sur un an, soit environ ±2,6 % par jour, est jugé « normal ».', use: 'Un DVOL bas : options bon marché, marché calme (souvent avant un mouvement). Un DVOL qui bondit : stress.' },
  atm: { what: 'Volatilité implicite « à la monnaie » : celle des options dont le prix d’exercice est égal au prix à terme.', calc: 'Interpolée entre les deux strikes qui encadrent le prix à terme ; « 30 j » : entre les deux échéances qui encadrent 30 jours.', use: 'Le prix de l’assurance contre un mouvement, toutes directions confondues.' },
  rr25: { what: 'Risk reversal 25 delta : vol du call 25 delta moins vol du put 25 delta.', read: 'Négatif : les puts (protections contre la baisse) sont plus chers que les calls. Positif : la hausse est plus recherchée.', use: 'Mesure de la peur directionnelle. Un skew qui devient très négatif montre une demande de protection.' },
  bf25: { what: 'Butterfly 25 delta : moyenne des vols 25 delta moins la vol à la monnaie.', use: 'Plus il est élevé, plus le marché paie pour des mouvements extrêmes (queues de distribution).' },
  pcr: { what: 'Rapport entre l’open interest des puts et celui des calls, en BTC.', use: 'Au-dessus de 1 : plus de puts ouverts que de calls. Indicateur de positionnement, pas de direction.' },
  trendScore: { what: 'Score de tendance de −5 à +5 : +1 par signal haussier, −1 par signal baissier, sur 5 signaux.', calc: 'Clôture > EMA 20 ; EMA 20 > EMA 50 ; EMA 50 > EMA 200 ; MACD au-dessus de son signal ; RSI 14 > 50. Haussier à +3 ou plus, baissier à −3 ou moins.', use: 'Une vue d’ensemble de la tendance, pas un signal d’entrée. Des unités de temps alignées dans le même sens décrivent une tendance plus nette.' },
  ema: { what: 'Moyenne mobile exponentielle : moyenne des clôtures qui donne plus de poids aux plus récentes.', use: 'Prix au-dessus de ses moyennes : tendance haussière ; les moyennes courtes au-dessus des longues confirment.' },
  rsi: { what: 'RSI 14 : force relative des hausses et des baisses sur 14 bougies, de 0 à 100.', read: 'Au-dessus de 70 : hausse très rapide (« surachat ») ; sous 30 : baisse très rapide (« survente »).', use: 'Ces zones disent qu’un mouvement est fort, pas qu’il va s’inverser : en tendance, le RSI peut y rester longtemps.' },
  macd: { what: 'MACD : écart entre deux moyennes mobiles (12 et 26), comparé à sa propre moyenne (9).', read: 'Positif : l’élan est haussier ; négatif : baissier.' },
  atr: { what: 'ATR : amplitude moyenne d’une bougie (14 bougies), en % du prix.', use: 'Sert à placer un stop hors du « bruit » normal et à dimensionner une position.' },
  fromHigh: { what: 'Écart de la clôture au plus haut de la dernière année environ.', use: '0 % : au plus haut ; −20 % : 20 % sous le plus haut.' },
  seasonMean: { what: 'Rendement moyen historique de la période.', read: 'La médiane (valeur du milieu) résiste mieux aux années exceptionnelles ; « Hausses » est la part des fois où la période a fini en hausse.', use: '« Faible » : trop peu d’observations pour en tirer quoi que ce soit. Une saisonnalité est une tendance passée, jamais une garantie.' },
  winRate: { what: 'Part des trades clos gagnants.', use: 'À lire avec le gain moyen et la perte moyenne : on peut gagner avec 35 % de réussite si les gains sont grands.' },
  profitFactor: { what: 'Somme des gains divisée par la somme des pertes.', read: 'Au-dessus de 1 : la méthode gagne ; 1,5 ou plus est confortable.' },
  expectancyR: { what: 'Espérance en R : gain moyen par trade, exprimé en multiples du risque pris (R = distance au stop × taille).', read: '+0,3 R : en moyenne, chaque trade rapporte 30 % de ce qu’il risquait.', use: 'Seuls les trades saisis avec un stop comptent.' },
  volatility: { what: 'Amplitude habituelle des variations quotidiennes, ramenée à un an (écart-type des rendements quotidiens × √ nombre de séances par an).', read: '60 % : des variations d’environ ±3,8 % par jour sont « normales » ; 15 % : environ ±0,9 %.', use: 'Comparer deux actifs à risque égal : un actif deux fois plus volatil bouge deux fois plus pour la même taille de position.' },
  maxDrawdown: { what: 'La pire baisse depuis un plus haut, sur la période.', use: 'Ce qu’il aurait fallu supporter en détenant l’actif au pire moment.' },
  correlation: { what: 'À quel point les rendements quotidiens des deux actifs vont dans le même sens, de −1 à +1.', read: '+1 : toujours ensemble ; 0 : sans lien ; −1 : toujours à l’opposé. Au-dessus de 0,5 : lien fort.', use: 'Deux actifs très corrélés ne diversifient pas un portefeuille. La corrélation change avec le temps : regarder la courbe sur 30 dates.' },
  beta: { what: 'Sensibilité de A aux mouvements de B : variation moyenne de A quand B bouge de 1 %.', read: 'Bêta 1,5 : quand B prend 1 %, A prend 1,5 % en moyenne.', use: 'À lire avec la corrélation : un bêta n’a de sens que si la corrélation est nette.' },
  worstStreak: { what: 'Plus longue suite de trades perdants consécutifs.', use: 'Pour dimensionner son risque : il faut pouvoir encaisser plusieurs fois cette série.' },
} satisfies Record<string, Help>;
export type Term = keyof typeof TERMS;

// --- Pages --------------------------------------------------------------------------------------

const MISSING = '« — » signifie qu’une donnée manque ; la raison s’affiche au survol, jamais une valeur inventée.';
const FRESH = 'Chaque panneau indique sa source et l’heure de sa dernière mise à jour ; « périmé » quand une source se tait trop longtemps.';
const NO_ADVICE = 'Ces données décrivent le marché ; elles ne disent pas quoi acheter ou vendre.';

export const PAGES: Record<string, PageHelp> = {
  overview: { intro: 'Le tableau de bord : le prix du BTC en direct, la watchlist, les prochains événements économiques, les titres urgents et l’humeur générale des marchés, sur un seul écran.', read: ['Le graphique BTC montre les séances (Asie, Londres, New York) et les plus hauts et plus bas de la veille et de la semaine.', 'La latence affichée est le délai entre l’heure de la plateforme et l’affichage.', MISSING], use: ['Commencer la journée ici, puis ouvrir l’écran détaillé d’un panneau en cliquant sur son titre ou par la palette (Ctrl K).', NO_ADVICE] },
  charts: { intro: 'Le graphique du contrat perpétuel BTC-USDT d’OKX en grand, en direct ; onglet « Nasdaq 100 » : le QQQ (fonds qui suit le Nasdaq 100) en bougies quotidiennes.', read: ['Bandes de couleur : séances de marché (heure de Paris).', 'Lignes : plus haut et plus bas de la veille et de la semaine, niveaux souvent surveillés par les traders.'], use: ['Repérer où se situe le prix par rapport aux niveaux de la veille et de la semaine avant de décider quoi que ce soit.', FRESH] },
  recap: { intro: 'Un résumé de chaque séance de marché (Asie, Londres, New York), écrit 5 minutes après la clôture par la machine Oracle.', read: ['Chaque fiche liste des faits calculés par le code : variation du BTC, CVD, liquidations, murs retirés, funding, chiffres publiés, titres urgents.', 'Une lecture rédigée par l’IA (Gemini) s’ajoute seulement si chaque chiffre cité correspond à un fait ; sinon « lecture automatique » (faits seuls).'], use: ['Rattraper une séance manquée en une minute.', 'Cliquer sur un fait pour ouvrir l’écran qui le montre.'] },
  hours: { intro: 'Les horaires des grandes places boursières, convertis à l’heure de Paris, avec leur état en direct.', read: ['Ouvert, pause, fermé, férié ou week-end, avec le compte à rebours du prochain changement.', 'Les heures suivent les fuseaux officiels et les changements d’heure de chaque pays.'], use: ['Savoir quels marchés bougent maintenant : la liquidité et la volatilité montent quand plusieurs places sont ouvertes en même temps (Londres et New York surtout).'] },
  assistant: { intro: 'L’assistant répond à vos questions en s’appuyant uniquement sur les données du terminal et cite chacune de ses sources.', read: ['Chaque chiffre de la réponse est vérifié : il doit figurer dans une donnée du terminal citée. Sinon, la réponse est écartée.', 'Les puces sous la réponse renvoient à l’écran qui montre la donnée.'], use: ['Demander « que s’est-il passé sur le BTC depuis l’ouverture de New York ? » ou « explique-moi cet article ».', 'Toujours vérifier : l’IA peut se tromper dans sa lecture, même avec des chiffres justes.'] },
  calendar: { intro: 'Le calendrier des publications économiques (inflation, emploi, taux…) de la semaine, avec le consensus et le chiffre réel capté à la seconde.', read: ['Prévu : le consensus des économistes ; Réel : le chiffre publié ; Surprise : l’écart, rapporté aux surprises passées (z-score).', 'Impact (couleur) : importance habituelle de la publication pour les marchés.', 'Toutes les heures sont celles de Paris.'], use: ['Éviter d’être exposé sans le savoir pendant une publication majeure : la volatilité y explose en quelques secondes.', 'La « Réaction BTC » montre comment le bitcoin a bougé dans les 30 minutes qui ont suivi.'] },
  news: { intro: 'Le fil d’actualités (crypto, macro, banques centrales) en temps réel, la lecture d’un article et l’assistant.', read: ['Chaque titre montre sa source, l’heure de publication et l’heure de réception.', 'Titres en langue d’origine (« VO ») ; traduction à la demande par l’assistant.', 'Les titres urgents sont en tête et peuvent être lus à voix haute (squawk).'], use: ['Ouvrir un titre pour le lire, puis poser une question à l’assistant sur l’article.', 'Une nouvelle n’a d’intérêt que si le marché ne l’a pas déjà intégrée : regarder la réaction du prix.'] },
  research: { intro: 'Les dernières publications de la recherche économique d’ING (ING THINK) : changes, taux, matières premières, économies.', read: ['Titre, thème, date et résumé fourni par ING ; l’article complet s’ouvre chez ING.', 'Lecture seule, pour un usage personnel : rien n’est republié.'], use: ['Comprendre comment une grande banque lit l’actualité macro, et confronter son scénario aux chiffres du terminal.'] },
  squawk: { intro: 'La lecture à voix haute des chiffres économiques et des titres urgents, dès leur arrivée.', read: ['Les chiffres sont dits en français à partir de nos données ; les titres dans leur langue d’origine.'], use: ['Activer la voix sur cet appareil pour être prévenu sans regarder l’écran pendant les publications importantes.'] },
  macro: { intro: 'La fiche économique d’un pays : inflation, emploi, croissance, taux directeur, avec leurs dernières valeurs et leur historique.', read: ['Chaque indicateur montre sa dernière valeur, la précédente, sa source et sa date.', 'L’historique se lit sur 5, 10 ou 20 ans.', MISSING], use: ['Comprendre dans quelle phase est une économie (inflation qui ralentit, emploi qui faiblit…) : c’est ce qui guide la banque centrale, donc la devise.'] },
  rates: { intro: 'Ce que les marchés de prédiction anticipent pour les prochaines décisions de taux des banques centrales.', read: ['Probabilités : chances, selon Polymarket et Kalshi, d’une baisse, d’un statu quo ou d’une hausse à la prochaine réunion.', 'Trajectoire implicite : taux attendu réunion après réunion.', 'Comités et votes : décisions passées et votes des membres quand ils sont publiés.'], use: ['Une probabilité qui bouge fortement après un chiffre (emploi, inflation) montre ce qui fait réagir les marchés.', 'Les marchés à risque (actions, crypto) réagissent souvent à un changement de ces anticipations plus qu’à la décision elle-même.'] },
  retail: { intro: 'Le positionnement des particuliers sur les plateformes crypto : qui est acheteur, qui est vendeur.', read: ['Ratio long/short : nombre de comptes acheteurs pour un compte vendeur. 2 signifie deux fois plus de comptes acheteurs.', 'L’écart à la moyenne sur 30 jours montre si ce positionnement est inhabituel.'], use: ['Un positionnement extrême d’un seul côté est souvent lu « à contre-courant » : quand tout le monde est acheteur, il reste peu d’acheteurs pour pousser le prix.'] },
  cot: { intro: 'Les positions des grandes catégories d’investisseurs sur les contrats à terme américains (rapport COT de la CFTC, chaque vendredi, données du mardi).', read: ['Position nette : contrats à l’achat moins contrats à la vente.', 'Percentile sur 3 ans : 100 = position la plus acheteuse de la période, 0 = la plus vendeuse.', 'Catégories : fonds spéculatifs (« leveraged funds »), gérants d’actifs, banques (« dealers »)…'], use: ['Repérer les positions extrêmes des spéculateurs : elles précèdent souvent des retournements quand elles se dénouent.', 'Données hebdomadaires avec 3 jours de retard : un outil de contexte, pas de timing.'] },
  bankpos: { intro: 'Les positions des banques sur les contrats à terme, d’après la CFTC.', read: ['Bank Participation Report (mensuel) : banques américaines et non américaines.', 'Catégorie « dealers » du rapport hebdomadaire : surtout de grandes banques, périmètre différent.'], use: ['Les banques couvrent souvent leurs clients : leur position est un contexte de fond, à lire sur plusieurs mois.'] },
  risk: { intro: 'Un indice de 0 à 100 qui résume l’appétit pour le risque des marchés à partir de 7 mesures.', read: ['0–25 : peur forte (« risk-off ») ; 45–55 : neutre ; 75–100 : appétit fort (« risk-on »).', 'Chaque composante est classée par rapport à sa dernière année (percentile) ; l’indice en fait la moyenne.'], use: ['En risk-off, les actifs risqués (crypto, actions de croissance) souffrent souvent ensemble.', 'Les extrêmes durent rarement : un indice très bas peut accompagner un point bas.'] },
  watch: { intro: 'La watchlist hors crypto : devises, or, indice dollar recalculé, Nasdaq et S&P 500 (via QQQ et SPY), taux américain à 10 ans.', read: ['Variation du jour, source, heure de la source et fraîcheur de chaque ligne.', 'QQQ et SPY sont des fonds cotés qui suivent le Nasdaq 100 et le S&P 500.'], use: ['Le dollar, les taux et les actions américaines influencent fortement le BTC : vérifier leur direction avant d’interpréter un mouvement crypto.'] },
  micro: { intro: 'La microstructure du BTC : ce qui se passe à l’intérieur du marché, seconde par seconde, sur 5 plateformes. On y voit qui attend (ordres posés), qui agit (ordres au marché) et qui est forcé de sortir (liquidations).', read: ['Carte de profondeur : les ordres en attente (dorés) et les échanges agressifs (bulles) sur les 60 dernières minutes.', 'Carnet d’ordres : les acheteurs et vendeurs en attente juste autour du prix.', 'CVD : qui, des acheteurs ou des vendeurs pressés, domine depuis 4 h, en spot et en perpétuel.', 'Onglet « Nasdaq 100 » : meilleur prix et spread du QQQ (IEX), cours de la séance, et ce qui n’a pas de source gratuite (profondeur, transactions, liquidations), avec la raison.', 'Liquidations, funding et open interest : l’état du levier sur le marché.'], use: ['Repérer où sont les grosses zones d’ordres, si elles tiennent ou disparaissent, et si le prix les traverse avec des achats ou des ventes agressifs.', 'Croiser : une hausse avec CVD spot en hausse, funding modéré et OI stable est jugée plus saine qu’une hausse portée par le seul levier.', NO_ADVICE] },
  season: { intro: 'Les comportements moyens du marché selon le calendrier : quels mois, jours ou heures ont historiquement été plutôt haussiers ou baissiers.', read: ['Chaque ligne : rendement moyen, médian, part des hausses et nombre d’observations.', '« Faible » : trop peu d’historique pour conclure.', 'La trajectoire de l’année compare l’année en cours à l’année moyenne.'], use: ['Un contexte statistique, jamais une prévision : une tendance moyenne peut être fausse plusieurs années de suite.'] },
  heatmap: { intro: 'Le classement fondamental des 8 grandes devises (dollar, euro, yen…) selon leurs données économiques.', read: ['Chaque thème (croissance, inflation, emploi…) reçoit un score relatif ; la couleur va du plus favorable (cyan) au moins favorable (rouge).', 'Le comparateur met deux devises face à face.'], use: ['Associer une devise forte à une devise faible pour comprendre la tendance de fond d’une paire.', 'Outil de contexte : le score n’a pas encore démontré sa capacité à prévoir (backtest affiché).'] },
  techmap: { intro: 'La tendance technique de chaque actif sur 4 unités de temps (1 h, 4 h, jour, semaine), en un coup d’œil.', read: ['Chaque case : Haussier, Neutre ou Baissier, avec un score de −5 à +5.', '« — » : historique non disponible (raison au survol).'], use: ['Des unités de temps alignées décrivent une tendance nette ; des cases contradictoires, un marché sans direction.', 'Cliquer sur un actif pour le détail des indicateurs.'] },
  indicators: { intro: 'La fiche technique d’un actif : moyennes mobiles, RSI, MACD, volatilité (ATR) et distance au plus haut, par unité de temps.', read: ['Tous les indicateurs sont calculés sur des bougies closes, avec les mêmes définitions que TradingView (Pine Script).'], use: ['Comprendre pourquoi la heatmap technique classe un actif haussier ou baissier, signal par signal.'] },
  options: { intro: 'Le marché des options BTC (Deribit) : combien le marché paie pour se protéger ou parier sur un mouvement. Onglet « Nasdaq 100 » : le VXN, volatilité implicite du Nasdaq 100, comparé au VIX.', read: ['Volatilité implicite : l’amplitude de mouvement que le prix des options suppose.', 'Skew (risk reversal) : les protections contre la baisse sont-elles plus chères que les paris à la hausse ?', 'Structure par terme : la volatilité attendue selon l’échéance.'], use: ['Une volatilité basse annonce souvent une période calme… avant un mouvement ; un skew très négatif montre de la peur.', 'L’open interest par strike montre les prix où beaucoup d’options sont ouvertes.'] },
  liquidity: { intro: 'La liquidité nette injectée par la banque centrale américaine (Fed) dans le système financier.', read: ['Liquidité nette = bilan de la Fed − compte du Trésor − reverse repo (chaque mercredi).', 'La profondeur du carnet BTC à ±1 % mesure la liquidité propre au bitcoin.'], use: ['Une liquidité nette qui monte a souvent accompagné les hausses des actifs risqués, dont le BTC, sur plusieurs mois. Contexte de fond, pas de timing.'] },
  track: { intro: 'Votre journal de trading : chaque trade saisi à la main, avec les statistiques calculées automatiquement.', read: ['Résultat, taux de réussite, profit factor, espérance en R, pire série et courbe des résultats.', 'R = risque pris sur le trade (distance au stop × taille).'], use: ['Saisir chaque trade avec son stop pour mesurer honnêtement sa méthode : l’espérance en R dit si elle gagne sur la durée.'] },
  calculator: { intro: 'Le calculateur de taille de position : combien acheter ou vendre pour ne pas risquer plus qu’un montant choisi.', read: ['Taille = risque accepté / distance entre l’entrée et le stop.', 'Pour les contrats OKX, la taille est arrondie au pas du contrat.', 'Les règles des sociétés de financement (perte journalière et maximale) sont vérifiées.'], use: ['Fixer le risque par trade (souvent 0,5 à 1 % du capital) avant d’entrer, jamais après.', 'Tout est calculé dans le navigateur, rien n’est envoyé.'] },
  portfolio: { intro: 'Le portefeuille boursier (PEA et autres enveloppes) : lignes, valorisation, performance, dividendes et risques.', read: ['Valorisation aux dernières clôtures connues, en euros (cours de la BCE pour les devises).', 'Performance : gains et pertes, réalisés et latents.'], use: ['Suivre l’allocation et la concentration du patrimoine, importer ses opérations depuis le courtier.'] },
  sources: { intro: 'L’état des sources du module Bourse : relevés planifiés, quotas des fournisseurs de données, dernières clôtures.', read: ['Chaque source montre son dernier relevé et son éventuelle erreur.'], use: ['Vérifier ici si une valeur du portefeuille paraît ancienne.'] },
  backtest: { intro: 'Le banc d’essai des stratégies : tester une stratégie écrite en Pine Script sur l’historique, avec des mesures honnêtes.', read: ['Capital et drawdown : évolution du compte et pire baisse depuis un sommet.', 'Dans et hors échantillon : la stratégie est jugée sur des données qu’elle n’a pas vues.', 'Monte Carlo : les résultats possibles si l’ordre des trades avait été différent.'], use: ['Se méfier d’une stratégie excellente « dans l’échantillon » et médiocre en dehors : elle est probablement sur-ajustée.', 'Les performances passées ne garantissent rien.'] },
  alerts: { intro: 'Les alertes : prix, chiffres économiques, mots-clés dans l’actualité, liquidations, murs retirés.', read: ['Chaque règle est armée, déclenchée ou coupée ; l’historique liste les déclenchements.', 'Canaux : notification dans le terminal, voix, Telegram.'], use: ['Créer une alerte sur les niveaux importants pour ne pas avoir à surveiller l’écran en permanence.'] },
  workspace: { intro: 'L’espace de travail : composer son propre écran en assemblant les écrans du terminal en panneaux, et garder ses mises en page.', read: ['Chaque panneau est un écran complet du terminal ; ses onglets se glissent pour diviser l’espace (à droite, en dessous) ou s’empiler.', 'Actif lié : l’actif choisi dans la barre ou dans un panneau (heatmap technique, indicateurs, saisonnalité) s’applique à tous les panneaux qui savent l’afficher.'], use: ['Partir d’un modèle (« Séance BTC », « Macro », « Analyse technique »), ajuster, puis « Enregistrer » sous un nom.', 'Les mises en page sont gardées dans ce navigateur : sur un autre appareil, les recréer.'] },
  compare: { intro: 'Comparer deux actifs sur un an : qui a fait le mieux, avec quel risque, et à quel point ils évoluent ensemble.', read: ['Performance en base 100 : les deux actifs partent de 100 au début de la période.', 'Volatilité, baisse maximale, meilleur et pire jour : le risque pris pour obtenir le rendement.', 'Corrélation et bêta : le lien entre leurs mouvements quotidiens.'], use: ['Vérifier si le BTC suit le Nasdaq (corrélation élevée) ou s’en détache.', 'Un rendement élevé obtenu avec une baisse maximale énorme n’est pas forcément meilleur.', 'Seules les dates où les deux actifs cotent sont comparées.'] },
  settings: { intro: 'Les réglages du terminal : mode de fonctionnement (en ligne ou avec la tour) et préférences de cet appareil.', read: ['Chaque mode indique d’où viennent les données.'], use: ['Choisir « En ligne » pour un fonctionnement sans ordinateur allumé à la maison.'] },
};
const SOON: PageHelp = { intro: 'Écran prévu dans une phase suivante du module Bourse.', read: ['Rien n’est encore affiché ici : aucune donnée n’est inventée en attendant.'], use: ['Voir le portefeuille et les sources du module Bourse en attendant.'] };
for (const id of ['equity', 'screener', 'watchlists', 'events', 'investors']) PAGES[id] = SOON;

// --- Panneaux (par écran ; clé = libellé du panneau, ou début du titre avant « · ») -----------------

export const PANELS: Record<string, Record<string, Help>> = {
  charts: {
    'Nasdaq 100 quotidien': { what: 'Le QQQ, fonds coté qui suit le Nasdaq 100, en bougies quotidiennes sur un an (cours ajustés des dividendes, Tiingo).', read: 'Bougie cyan : clôture au-dessus de l’ouverture ; rouge : en dessous.', use: 'Le BTC et le Nasdaq sont souvent liés : comparer leurs tendances, ou ouvrir « Comparer deux actifs ».' },
  },
  overview: {
    'BTC-USDT': { what: 'Le prix du contrat perpétuel BTC-USDT d’OKX en direct, en bougies.', read: 'Bandes : séances ; lignes : plus hauts et plus bas de la veille et de la semaine.', use: 'Situer le prix par rapport à ces niveaux de référence.' },
    Watchlist: { what: 'Les actifs suivis avec leur dernier prix, leur variation et une mini-courbe.', use: 'Vérifier d’un coup d’œil si le mouvement du BTC est isolé ou partagé par les autres marchés.' },
    'Prochains événements': { what: 'Les prochaines publications économiques importantes, à l’heure de Paris.', use: 'Anticiper les moments de forte volatilité.' },
    'Titres urgents': { what: 'Les dernières nouvelles marquées urgentes par nos sources.', use: 'Comprendre un mouvement brusque du prix.' },
    'Sentiment de risque': { what: 'L’indice 0–100 d’appétit pour le risque (détail sur l’écran Sentiment de risque).' },
    'Gérer les règles': { what: 'Accès rapide aux règles d’alerte.' },
  },
  recap: { '*': { what: 'Le récap d’une séance : faits calculés par le code, chacun avec sa source, et lecture de l’IA seulement si chaque chiffre cité est vérifié.', use: 'Cliquer un fait pour ouvrir l’écran qui le montre.' } },
  hours: {
    'Séances du jour': { what: 'Les heures d’ouverture des places sur 24 h, à l’heure de Paris.', use: 'Les chevauchements (Londres + New York, de 14 h 30 à 17 h 30 environ) concentrent le volume.' },
    Places: { what: 'L’état de chaque place en direct et le temps avant le prochain changement.' },
    'Prochaines fermetures': { what: 'Les jours fériés à venir, où une place reste fermée et où la liquidité baisse.' },
  },
  calendar: {
    'Publications de la semaine': { what: 'Toutes les publications de la semaine avec heure (Paris), pays, impact, prévu, précédent et réel.', read: 'Surprise = réel − prévu, comparée aux surprises passées (z-score) : au-delà de ±1, la surprise est notable.', use: 'Cliquer une ligne pour sa fiche.' },
    Fiche: { what: 'La fiche d’une publication : définition, historique des chiffres, révisions.' },
    'Réaction BTC': { what: 'Le mouvement du BTC dans les 30 minutes suivant la publication.', use: 'Voir si le marché a réagi dans le sens de la surprise ou à contre-sens.' },
  },
  news: {
    'Fil d’actus': { what: 'Le fil en temps réel : source, heure de la source, catégorie, « VO » pour la langue d’origine.', use: 'Filtrer par catégorie ; cliquer pour lire.' },
    Lecture: { what: 'Le texte de l’article choisi, avec sa source et son heure.' },
    Assistant: { what: 'Questions sur l’article ou sur les données du terminal ; chaque chiffre de la réponse est vérifié et sourcé.', use: 'Ex. : « qu’est-ce que ça change pour la Fed ? ». La mention « à vérifier » rappelle que l’IA peut mal interpréter.' },
  },
  research: { 'Dernières publications': { what: 'Les articles récents d’ING THINK, du plus récent au plus ancien.', read: 'Thème (FX, taux, matières premières…), date, résumé d’ING.', use: 'Ouvrir l’article chez ING pour l’analyse complète.' } },
  squawk: {
    'Voix et son': { what: 'Activation de la lecture à voix haute sur cet appareil.' },
    'Réglages de cet appareil': { what: 'Choix des voix et des annonces, gardés dans ce navigateur.' },
    'Dernières annonces': { what: 'Ce qui a été dit récemment.' },
  },
  macro: {
    Indicateurs: { what: 'Les indicateurs du pays : dernière valeur, précédente, date, source.', use: 'Comparer la tendance des derniers mois plutôt qu’un chiffre isolé.' },
    Historique: { what: 'L’évolution d’un indicateur sur 5, 10 ou 20 ans.' },
    'Prochaines publications': { what: 'Les prochains chiffres attendus pour ce pays.' },
  },
  rates: {
    'Prochaine réunion': { what: 'Probabilités de chaque décision (baisse, statu quo, hausse) à la prochaine réunion, par source.', read: 'Deux sources très différentes signalent un marché peu liquide ou une incertitude.', use: 'Une décision « surprise » par rapport à ces probabilités fait bouger fortement les marchés.' },
    'Trajectoire implicite': { what: 'Le taux directeur attendu à chaque réunion à venir, comparé au taux actuel.', use: 'Une pente descendante : le marché attend des baisses.' },
    'Comités et votes': { what: 'Les dernières décisions et la répartition des votes (dissidents) quand la banque les publie. La BCE ne publie pas ses votes.', use: 'Des dissidents en faveur d’une baisse annoncent souvent un changement de cap.' },
    'Évolution des probabilités': { what: 'Évolution des probabilités sur 60 jours, avec les publications (emploi, inflation) superposées.', use: 'Voir quel chiffre a déplacé les anticipations.' },
  },
  retail: {
    'Ratios long/short': { what: 'Comptes acheteurs / comptes vendeurs, et pour les « gros comptes », positions acheteuses / vendeuses, par plateforme.', calc: 'Écart = ratio actuel comparé à sa moyenne sur 30 jours.', use: 'Un écart extrême est lu à contre-courant.' },
    Financement: { what: 'Le funding des perpétuels : ce que paient les acheteurs à levier pour rester positionnés.', use: 'Très positif : marché chargé en acheteurs à levier.' },
    Changes: { what: 'Positionnement des particuliers sur les devises : aucune source libre fiable, donc « — ».' },
  },
  cot: {
    'Positions nettes': { what: 'Position nette de la catégorie choisie sur chaque marché, sa variation sur une semaine et son percentile sur 3 ans.', use: 'Les percentiles proches de 0 ou 100 signalent un positionnement extrême.' },
    'Toutes catégories': { what: 'Les positions de toutes les catégories sur le marché choisi : qui est acheteur, qui est vendeur.' },
    Historique: { what: 'L’évolution de la position nette sur le marché choisi.' },
  },
  bankpos: {
    Banques: { what: 'Positions des banques américaines et non américaines (rapport mensuel de la CFTC).' },
    '*': { what: 'Catégorie « dealers » du rapport hebdomadaire TFF : surtout de grandes banques, périmètre différent.' },
  },
  risk: {
    'Indice composite': { what: 'L’indice d’appétit pour le risque de 0 à 100 et sa zone (peur forte à appétit fort).', calc: 'Moyenne des percentiles sur 252 séances (un an de bourse) de 7 composantes.' },
    Composantes: { what: 'Les 7 mesures : VIX (peur sur les actions), tendance du S&P 500, crédit à haut rendement, AUD/JPY, cuivre/or, actions contre obligations, momentum crypto.', read: 'Chaque barre : où se situe la mesure par rapport à sa dernière année (100 = le plus « risk-on »).', use: 'Voir quelles mesures tirent l’indice.' },
    'Historique de l’indice': { what: 'L’évolution de l’indice dans le temps.' },
    SPY: { what: 'Le S&P 500 (via le fonds SPY) sur un an.' },
    VIX: { what: 'Le VIX sur un an : la volatilité attendue du S&P 500 sur 30 jours, souvent appelé « indice de la peur ».', read: 'Sous 15 : calme ; au-dessus de 30 : stress.' },
  },
  watch: {
    'Watchlist hors crypto': { what: 'Devises, or, indice dollar recalculé, QQQ, SPY, taux à 10 ans : prix, variation, source, heure.', use: 'Un dollar et des taux en hausse pèsent souvent sur les actifs risqués.' },
    'Sources et limites': { what: 'D’où vient chaque ligne et ce qui manque, avec la raison.' },
  },
  micro: {
    'Carte de profondeur': { what: 'La carte des ordres en attente (liquidité au repos) et des échanges agressifs sur les 60 dernières minutes, agrégée sur les carnets des perpétuels BTC de 4 plateformes.', read: 'Axe horizontal : le temps (une colonne toutes les 40 s) ; axe vertical : le prix. Le doré indique les BTC en attente (plus clair = plus gros) ; la ligne blanche est le prix ; les bulles cyan et rouges sont les achats et ventes au marché.', use: 'Les bandes dorées épaisses sont des zones où le prix risque de ralentir. Regarder si elles tiennent quand le prix arrive (rebond) ou si elles sont consommées (cassure) ou retirées avant (« mur retiré »).', calc: 'Paliers de couleur : centiles 50, 80, 93 et 98 des tailles de la carte. La carte se remplit depuis l’ouverture ; rien n’est stocké.' },
    'Carnet d’ordres': { what: 'Le carnet d’ordres agrégé : tous les ordres limites en attente juste au-dessus (vendeurs, en rouge) et juste en dessous (acheteurs, en cyan) du dernier prix, additionnés sur plusieurs plateformes par pas de 10 $.', read: 'Prix : niveau ; Taille BTC : quantité en attente à ce niveau ; Cumul : quantité totale depuis le milieu jusqu’à ce niveau. La barre la plus longue est surlignée. Au survol d’une ligne : la part de chaque plateforme.', use: 'Un gros niveau proche peut freiner le prix. Un carnet très fin d’un côté laisse le prix se déplacer facilement dans ce sens. Les ordres peuvent être annulés à tout moment : ils montrent des intentions, pas des engagements.' },
    'CVD spot et perpétuel': { what: 'CVD (Cumulative Volume Delta) : le cumul, minute par minute, des achats agressifs moins les ventes agressives, sur 4 heures. Une courbe pour le marché au comptant (spot), une pour les perpétuels.', read: 'Courbe qui monte : les acheteurs pressés dominent ; qui descend : les vendeurs pressés dominent. « Divergence » : spot et perpétuel en sens opposés.', use: 'Prix en hausse avec CVD en hausse : mouvement confirmé par les échanges. Prix en hausse avec CVD en baisse : hausse portée par peu d’échanges agressifs, ou vendeurs qui absorbent. Le spot (vrais BTC) est souvent jugé plus significatif que le perpétuel (levier).', calc: 'Perpétuel : Binance, Bybit, OKX, Hyperliquid ; spot : Binance, Coinbase, OKX (statistique 5 min). Rattrapage des 4 dernières heures au chargement.' },
    Liquidations: { what: 'Les positions à levier fermées de force par les plateformes sur la dernière heure.', read: 'Longs (rouge) : acheteurs forcés de vendre ; Shorts (cyan) : vendeurs forcés de racheter. Heure, plateforme, montant, prix.', use: 'Des liquidations en cascade accélèrent un mouvement puis l’épuisent souvent. Un gros total de longs liquidés après une chute signale un « nettoyage » du levier acheteur.', calc: 'Liquidations réellement publiées par Binance, Bybit et OKX, additionnées. Binance et OKX n’en publient qu’une par seconde au plus : les totaux sont des minimums. Hyperliquid : aucun flux public. Aucun niveau de liquidation estimé.' },
    'Funding et open interest': { what: 'Le coût du levier (funding) et la quantité de contrats ouverts (open interest) sur les perpétuels BTC de chaque plateforme.', read: 'Funding positif : les acheteurs paient les vendeurs ; ramené à 8 h. OI : valeur des positions ouvertes ; OI 24 h : variation en BTC sur 24 h. Prime : écart entre le perpétuel et le comptant.', use: 'Funding élevé + OI en forte hausse : beaucoup de levier acheteur, marché fragile à la baisse. Funding négatif pendant une hausse : les vendeurs à découvert risquent d’être forcés de racheter (squeeze).', calc: 'Total : moyenne pondérée par l’OI en dollars.' },
    'Cotation QQQ': { what: 'Le meilleur prix d’achat et de vente du QQQ sur la Bourse IEX, relevé toutes les 3 minutes (Tiingo).', read: 'Spread : écart entre les deux, en dollars et en points de base (1 pb = 0,01 %).', use: 'Un spread qui s’élargit signale un marché moins liquide (ouverture, annonce). IEX ne représente qu’une petite part des échanges.' },
    'Séance QQQ': { what: 'Le cours du QQQ toutes les 3 minutes sur les dernières 24 heures.', use: 'Situer le Nasdaq dans sa séance pendant que le BTC bouge.' },
    'Données de microstructure Nasdaq': { what: 'Chaque donnée de l’onglet BTC, et pourquoi elle manque pour le Nasdaq : les flux de carnet et de transactions des Bourses américaines et du CME sont payants.', use: 'Rien n’est estimé à la place : « — » et la raison.' },
    'Journal des flux': { what: 'L’historique des connexions aux plateformes : coupures, reconnexions et trous de données.', use: 'Vérifier qu’une donnée étrange ne vient pas d’une coupure.' },
  },
  season: {
    Trajectoire: { what: 'La performance cumulée depuis le 1er janvier : l’année moyenne (cyan) et l’année en cours (or).', use: 'Voir si l’année en cours est en avance ou en retard sur le schéma moyen.' },
    'Par mois': { what: 'Rendement de chaque mois civil, clôture à clôture, sur tout l’historique.' },
    'Par jour de semaine': { what: 'Rendement quotidien moyen selon le jour de la semaine (date UTC de la bougie).' },
    'Par heure de Paris': { what: 'Rendement moyen de chaque heure (ouverture → clôture de la bougie horaire), à l’heure de Paris, changements d’heure compris.', use: 'Les heures d’ouverture de Londres et New York concentrent souvent les mouvements.' },
    'Par jour du mois': { what: 'Rendement quotidien moyen selon le jour du mois (1 à 31).' },
  },
  heatmap: {
    'Classement relatif': { what: 'Les 8 devises classées de la plus favorable à la moins favorable selon leurs fondamentaux.' },
    'Fiche devise': { what: 'Le détail de la devise choisie : score par thème et indicateurs qui le composent.' },
    'Matrice fondamentale': { what: 'Devises × thèmes : chaque case est un score relatif, coloré du plus favorable au moins favorable.', use: 'Repérer une devise forte partout ou faible partout.' },
    'Lecture fondamentale': { what: 'Un résumé rédigé automatiquement à partir des scores, sans IA.' },
    Paire: { what: 'Le comparateur : les deux devises d’une paire face à face, thème par thème.', use: 'Un grand écart de fondamentaux entre deux devises décrit une tendance de fond possible pour la paire.' },
  },
  techmap: { Tendance: { what: 'Tendance de chaque actif par unité de temps : Haussier, Neutre ou Baissier, avec le score.', read: 'Score de −5 à +5 : +1 par signal haussier, −1 par signal baissier (EMA 20, 50, 200, MACD, RSI). Détail des signaux au survol.', use: 'Cliquer un actif pour sa fiche Indicateurs.' } },
  indicators: {
    '*': { what: 'Les valeurs des indicateurs pour chaque unité de temps, calculées sur des bougies closes.', read: 'Tendance et score, clôture, moyennes mobiles, RSI, MACD, ATR, distance au plus haut, nombre de bougies utilisées.' },
    Signaux: { what: 'Les 5 signaux qui composent le score de tendance du quotidien, chacun +1 ou −1.' },
    Clôtures: { what: 'Les clôtures quotidiennes des 120 derniers jours.' },
  },
  options: {
    'Vue d’ensemble': { what: 'Les mesures clés des options BTC ramenées à 30 jours : volatilité implicite, skew, butterfly, rapport puts/calls.', use: 'Survoler chaque mesure pour sa définition.' },
    'Structure par terme': { what: 'La volatilité implicite à la monnaie pour chaque échéance, avec le skew et l’open interest.', read: 'Courbe montante : plus de volatilité attendue à long terme (marché calme) ; descendante (« inversée ») : stress à court terme.', use: 'Cliquer une échéance pour son sourire et son open interest.' },
    Sourire: { what: 'Le « sourire de volatilité » : la volatilité implicite selon le prix d’exercice (strike), pour l’échéance choisie. Ligne pointillée : prix à terme.', read: 'Côté gauche plus haut : les protections contre la baisse sont plus chères.', use: 'La forme du sourire dit de quel côté le marché craint un mouvement.' },
    'Open interest': { what: 'Le nombre d’options ouvertes (en BTC) à chaque strike, calls et puts, pour l’échéance choisie.', use: 'Les strikes très chargés peuvent attirer ou freiner le prix à l’approche de l’échéance (couvertures des vendeurs d’options).' },
    VXN: { what: 'Le VXN : la volatilité que le marché des options anticipe pour le Nasdaq 100 sur 30 jours (Cboe), comparée au VIX du S&P 500.', read: '25 : variations d’environ ±1,6 % par jour jugées normales. Un VXN au-dessus du VIX : le Nasdaq est vu plus risqué que le marché large.', use: 'Un VXN qui bondit accompagne souvent la baisse des valeurs technologiques… et du BTC.' },
    'Chaîne d’options Nasdaq': { what: 'Sourire, skew et open interest des options du Nasdaq : aucune source gratuite autorisée (OPRA, Cboe payants).' },
    Historique: { what: 'Le DVOL horaire de Deribit et nos relevés de volatilité à 30 jours et de skew sur 90 jours.', use: 'Situer le niveau actuel par rapport aux dernières semaines.' },
  },
  liquidity: {
    'Liquidité nette': { what: 'La liquidité nette de la Fed et sa variation.', calc: 'Bilan total de la Fed − compte général du Trésor − reverse repo, au mercredi.' },
    Composantes: { what: 'Les trois éléments du calcul, avec leur source et leur date.', use: 'Voir lequel fait bouger la liquidité (la Fed, le Trésor ou les fonds monétaires).' },
    Historique: { what: 'La liquidité nette sur 3 ans.' },
    'Profondeur du carnet BTC': { what: 'La quantité d’ordres en attente à ±1 % du prix BTC : la liquidité propre au bitcoin.', use: 'Plus elle est faible, plus un gros ordre fait bouger le prix.' },
  },
  track: {
    Statistiques: { what: 'Les statistiques des trades clos : résultat, réussite, profit factor, espérance en R, gain et perte moyens, pire série, courbe.', use: 'Survoler chaque mesure pour sa définition.' },
    'Nouveau trade': { what: 'Saisie d’un trade : actif, sens, dates, quantité, prix, stop, frais, setup, notes.', use: 'Toujours saisir le stop : sans lui, le trade ne compte pas dans l’espérance en R.' },
    Journal: { what: 'Tous les trades saisis, du plus récent au plus ancien, avec leur résultat et leur R.' },
  },
  calculator: {
    Saisie: { what: 'Capital, risque accepté (en % ou en $), instrument, prix d’entrée et stop ; société de financement éventuelle.' },
    Résultat: { what: 'La taille à prendre pour que la perte au stop égale le risque choisi, avec le levier qui en découle.', calc: 'Taille = risque / |entrée − stop| ; contrats OKX arrondis vers le bas au pas du contrat.', use: 'Un levier élevé n’augmente pas le risque si le stop est respecté, mais rapproche le prix de liquidation.' },
  },
  backtest: {
    'Éditeur Pine Script': { what: 'Le code de la stratégie, en Pine Script (le langage de TradingView).' },
    'Données et simulation': { what: 'L’actif, l’unité de temps et la période testés, avec la source des bougies.' },
    'Stratégies connues': { what: 'Des stratégies classiques prêtes à tester, pour comparer.' },
    'Plan de recherche': { what: 'La recherche autonome : l’IA propose des variantes de stratégie, le moteur les teste toutes sur les mêmes règles.', use: 'Plus on teste de variantes, plus le risque de trouver un bon résultat par hasard augmente : les mesures en tiennent compte.' },
    Recherches: { what: 'Les recherches lancées et leur état.' },
    'Suivi de la recherche': { what: 'L’avancement d’une recherche : variantes testées, meilleures retenues, journal.' },
    Paramètres: { what: 'Les réglages de la stratégie et de la simulation (capital, frais, glissement).' },
    'Capital et drawdown': { what: 'L’évolution du capital et le drawdown, c’est-à-dire la baisse depuis le plus haut précédent.', use: 'Le pire drawdown dit ce qu’il aurait fallu supporter.' },
    'Dans et hors échantillon': { what: 'Les résultats sur la période d’optimisation et sur une période jamais vue.', use: 'Un grand écart signale un sur-ajustement.' },
    'Monte Carlo': { what: 'Des milliers de tirages de l’ordre des trades pour estimer la dispersion possible des résultats.' },
    'Mesures notées': { what: 'Les mesures de performance (rendement, ratio de Sharpe, drawdown…) avec une note.' },
    'Journal des transactions': { what: 'Chaque trade simulé : entrée, sortie, résultat.' },
    'Sociétés de financement': { what: 'Si la stratégie aurait respecté les règles de FTMO ou Lucid (perte journalière, perte maximale).' },
    'Assistant IA': { what: 'Aide à écrire ou expliquer une stratégie (Gemini) ; le code proposé est toujours testé avant d’être cru.' },
  },
  alerts: {
    Règles: { what: 'Les règles d’alerte et leur état (armée, déclenchée, coupée).' },
    'Nouvelle règle': { what: 'Créer une alerte : prix, chiffre économique, mot-clé, liquidations, mur retiré.' },
    Déclenchements: { what: 'L’historique des alertes déclenchées.' },
    Telegram: { what: 'L’envoi des alertes sur Telegram et son essai.' },
  },
  compare: {
    Performance: { what: 'L’évolution des deux actifs depuis le début de la période, ramenés à 100.', use: 'L’écart entre les courbes à droite est l’écart de performance.' },
    Mesures: { what: 'Rendement, volatilité annualisée, baisse maximale, meilleur et pire jour et dernier cours de chaque actif.' },
    Corrélation: { what: 'La corrélation des rendements quotidiens sur l’année et sa version glissante sur 30 dates, avec le bêta.', use: 'Une corrélation qui monte en période de stress est fréquente : les actifs risqués chutent ensemble.' },
    Ratio: { what: 'Le cours de A divisé par celui de B, base 100.', use: 'Une tendance du ratio montre une surperformance durable de l’un sur l’autre.' },
  },
  portfolio: { '*': { what: 'Une vue du portefeuille boursier : lignes, valorisation, performance, dividendes ou risques, selon le panneau.' } },
  sources: { '*': { what: 'L’état d’une source du module Bourse : dernier relevé, quota, erreur éventuelle.' } },
};

/** Aide d'un panneau : libellé exact, titre exact, puis début du titre (avant « · »), sinon « * » de l'écran. */
export function panelHelp(screen: string, title: string, label?: string): Help | null {
  const p = PANELS[screen];
  if (!p) return null;
  const head = title.split(' · ')[0].trim();
  const first = head.split(' ')[0];
  for (const k of [label, title, head, label?.split(' ')[0], first]) if (k && p[k]) return p[k];
  return p['*'] ?? null;
}
