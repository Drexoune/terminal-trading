# Plan B1 — Portefeuille

> **Validé le 20/11/2026 (T-038 : XTB, PEA et CTO, performances depuis le 28/09/2026, benchmarks MSCI World et S&P 500, ventilation des ETF affichée).** Cadre : `docs/plan-bourse.md` (T-036), décisions T-027 à T-034, fondations de B0 (`docs/plan-b0.md`). Le code commence après la porte de B0, le 21/11 au matin, et cède la priorité à P1 autour du 04/12, du 08/12 et du 10/12 (T-027).

## 1. Objectif et porte

B1 transforme les lignes suivies par B0 en portefeuille. Il couvre :

- les enveloppes et les opérations ;
- l'import du Trading Desk et d'un fichier .xlsx ;
- la valorisation de chaque nuit ;
- les performances (TWR, MWR, TRI), l'allocation, les risques, les dividendes reçus et les benchmarks.

L'écran `PTF` (« Portefeuille ») quitte son état « arrive en B1 ».

**Porte de B1** :

- ton portefeuille réel est importé et valorisé chaque nuit sans intervention. Chaque montant affiche sa source, sa date de valeur et son heure de calcul ;
- les calculs donnent les résultats attendus sur les cas de test :
  - le TRI est égal à `XIRR` d'Excel à 10⁻⁶ près ;
  - Dietz modifié et TWR sont vérifiés sur des exemples calculés à la main ;
  - la volatilité, la perte maximale et le bêta sont vérifiés sur des séries connues ;
- un cours manquant ou périmé s'affiche « — » ou « périmé » avec sa raison. Aucune valeur n'est recopiée ni inventée ;
- l'écran tient à 1 440 et 390 px, sans défilement horizontal, et sa capture est relue.

## 2. Découpage

| Tâche | Contenu | Vérification |
| --- | --- | --- |
| B1.1 Tables | migration `…_bourse_b1.sql` : enveloppes, opérations, lots d'import, valorisations quotidiennes, taux et prélèvements (§ 4) | migration appliquée sur une base locale ; RLS sans politique |
| B1.2 Calculs | bibliothèque pure `api/_lib/bourse/perf.ts` : positions à une date, valorisation, flux externes, TWR chaîné, Dietz modifié, TRI (XIRR), volatilité, perte maximale, bêta, corrélation | tests Vitest sur des cas calculés à la main et sur les valeurs d'Excel |
| B1.3 Contrôle par le Trading Desk | lecture des lignes du PEA et des liquidités dans la base de l'artefact (T-032), comparées aux positions reconstituées depuis l'export XTB ; l'artefact n'est jamais modifié | écart affiché ligne par ligne, relu avec toi |
| B1.4 Import de l'export XTB | lecture dans le navigateur (SheetJS) de l'historique du compte XTB (.xlsx) depuis le 28/09/2026 : versements, achats, ventes, dividendes, frais ; correspondance des colonnes, aperçu, détection des doublons, validation, puis envoi au serveur ; un lot se rejoue ou s'annule d'un bloc | tests sur ton fichier anonymisé ; un fichier invalide est refusé avec la ligne fautive |
| B1.8 Ventilation des ETF | table `instrument_exposures` : pays, secteur et devise par ETF, saisis depuis la fiche de l'émetteur avec son adresse et sa date ; fiche de plus de 3 mois marquée « périmée » ; part non couverte en « Non ventilé » | somme des poids égale à 100 % par axe, ou écart affiché |
| B1.5 Valorisation de la nuit | tâche `valuation` de `bourse-jobs`, après `eu-close` (07:50 Paris) : valeur par ligne, enveloppe et total, flux du jour, indice TWR | tests Vitest sur base simulée, dont jour sans cours et devise étrangère |
| B1.6 Routes | `/api/bourse/portfolio` (synthèse), `/api/bourse/transactions` (liste, ajout, correction, suppression), `/api/bourse/import` (lot) ; mêmes règles de session que B0 | tests de contrat ; 401 sans session |
| B1.7 Écran `PTF` | en-tête de valorisation, lignes, performance contre benchmarks, allocation, risques, dividendes, opérations, import | captures 1 440 et 390 px, Playwright, accessibilité |

Ordre : B1.1 et B1.2 d'abord, puis B1.4 (les performances partent du 28/09/2026 : il faut les opérations depuis cette date), puis B1.3, puis B1.5 et B1.6, puis B1.8 et B1.7.

## 3. Calculs

Ces calculs sont faits dans notre code, en décimal exact pour les montants (`numeric` en base ; en TypeScript, montants en centimes entiers ou en texte décimal, jamais en flottant). Seuls les rendements et les statistiques se calculent en flottant.

- **Position à une date** : somme des opérations typées jusqu'à cette date. Les types sont achat, vente, dividende, versement, retrait, frais, taxe, division et position d'ouverture. Le PRU est calculé au coût moyen pondéré, la règle fiscale du PEA.
- **Valorisation** : quantité × dernière clôture connue à la date, convertie en euros au cours BCE du même jour (ou du dernier jour ouvré). Une clôture de plus de 5 jours ouvrés est marquée « périmée » et comptée à part.
- **Flux externes** : versements et retraits de l'enveloppe. Les achats et les ventes sont internes ; un dividende reste dans l'enveloppe.
- **TWR** (rendement pondéré par le temps) : chaîne des rendements quotidiens `(V_fin − F) / V_début − 1`. Le flux est compté en début de journée ; la convention est affichée.
- **Dietz modifié** : `(V_fin − V_début − ΣF) / (V_début + Σ w·F)`, avec `w` la part de la période restant après le flux. C'est l'approximation du MWR sur une période.
- **TRI (MWR annualisé)** : racine de `Σ F_i / (1+r)^((d_i − d_0)/365) = 0`, comme `XIRR` d'Excel. Méthode de Newton, avec dichotomie de secours. Pas de résultat si le signe des flux ne change pas : « — · TRI non défini ».
- **Risques** sur les rendements quotidiens du TWR :
  - volatilité annualisée (× √252) ;
  - perte maximale et sa durée ;
  - bêta et corrélation contre chaque benchmark, sur les jours communs.

  En dessous de 60 jours de données : « — · historique trop court ».
- **Benchmarks** (T-038) : ETF de référence, dividendes réinvestis (plan Bourse § 1) : MSCI World (`CW8.PAR`) et S&P 500. Un benchmark déjà suivi comme ligne ne coûte rien de plus ; `CW8.PAR` ajoute au plus une requête Alpha Vantage par nuit, dans le budget de 20.
- **Origine** : toutes les performances « depuis l'origine » partent du 28/09/2026 (T-038).

## 4. Tables (migration `…_bourse_b1.sql`)

Mêmes règles que B0 : `numeric` pour les montants, RLS activée sans politique, droits retirés à `anon` et `authenticated`.

| Table | Colonnes principales |
| --- | --- |
| `envelopes` | `id`, `kind` (PEA, PEA-PME, CTO, AV, livret, compte), `name`, `broker`, `opened_on`, `currency`, `closed_on` |
| `transactions` | `id`, `envelope_id`, `trade_date` (Paris), `kind`, `listing_id`, `quantity`, `price`, `amount` (signé, en devise de l'enveloppe), `fees`, `taxes`, `currency`, `fx_rate`, `note`, `batch_id`, `source` (Trading Desk, import, saisie), `created_at` |
| `import_batches` | `id`, `source`, `file_name`, `file_sha256`, `rows`, `imported_at`, `reverted_at` |
| `daily_valuations` | `day`, `scope` (ligne, enveloppe, total), `scope_id`, `value_eur`, `flows_eur`, `twr_index`, `stale_lines`, `computed_at` ; clé (`day`, `scope`, `scope_id`) |
| `rate_schedules`, `tax_rates` | taux des livrets et des fonds euros ; prélèvements sociaux datés (plan Bourse § 6). Tables créées ; écrans à B1 seulement si Q2 inclut livrets ou assurance-vie |

## 5. Routes

| Route | Rôle |
| --- | --- |
| `GET /api/bourse/portfolio?scope=&from=&to=` | synthèse : valeur, lignes, performance, allocation, risques, benchmarks, avec source et date de chaque montant |
| `GET /api/bourse/transactions?envelope=` | opérations, triées par date |
| `POST`, `PATCH`, `DELETE /api/bourse/transactions` | saisie et correction à la main (même origine, corps JSON, comme la connexion de B0) |
| `POST /api/bourse/import` | un lot validé côté serveur, écrit dans une transaction ; `DELETE` annule le lot |

Toutes passent par la fonction unique `api/bourse.ts` et refusent de répondre sans session.

## 6. Écran `PTF`

Conçu avec le design system, sans maquette (T-033). Morceaux repris du Trading Desk et réécrits avec les composants du terminal : donut de répartition, table des lignes (poids, plus-value latente, cours périmé), lecture des nombres à la française.

- **En-tête** :
  - valeur totale et variation du jour ;
  - plus-value latente ;
  - performance TWR et TRI sur la période choisie (1 M, 3 M, YTD, 1 A, depuis l'origine) ;
  - date de valeur et heure du calcul.
- **Enveloppes** : un onglet par enveloppe, plus « Total ».
- **Lignes** :
  - quantité, PRU, cours (avec source et date), valeur, poids et plus-value latente ;
  - éligibilité PEA, avec sa raison.
- **Performance** : courbe du TWR contre les deux benchmarks (Lightweight Charts, base 100 au 28/09/2026).
- **Allocation** :
  - par ligne et par devise ;
  - par pays, par secteur et par devise sous-jacente, à travers les ETF (B1.8) ;
  - chaque poids indique la fiche de l'émetteur et sa date. La part non couverte reste « Non ventilé ».
- **Risques** : volatilité, perte maximale, bêta et corrélation, avec la période et le nombre de jours.
- **Dividendes reçus** : par mois et par ligne, d'après les opérations.
- **Opérations** : liste filtrable, saisie et correction. L'import passe par un assistant en 3 étapes (fichier, colonnes, aperçu).

## 7. Tests

- **Calculs** : cas à la main, avec flux en début, en milieu et en fin de période ; TRI comparé à Excel sur 5 jeux de flux ; TRI non défini ; division ; vente partielle (PRU inchangé) ; devise étrangère.
- **Import** : colonnes manquantes, dates françaises, nombres à virgule, doublons, lot rejoué, lot annulé.
- **Valorisation** : jour férié, cours périmé, ligne sans cours, cours BCE manquant.
- **Écran** : Playwright à 1 440 et 390 px, accessibilité, aucun montant de démonstration en production.

## 8. Ce que B1 ne fait pas

- Pas de fiscalité au-delà des prélèvements datés (pas de déclaration).
- Pas de calendrier des détachements à venir : il arrive en B4.
- Pas d'ordre : le terminal n'en passe jamais.
- Aucun montant du portefeuille n'est envoyé à Gemini (plan Bourse § 4).

## 9. Ce dont j'ai besoin de toi

| Quand | Quoi |
| --- | --- |
| avant B1.3 | confirmer que l'import du Trading Desk se fait depuis sa base d'artefact, que je lis sans rien y écrire (T-032) |
| avant B1.4 | l'export de l'historique du compte PEA chez XTB depuis le 28/09/2026 (.xlsx), déposé dans `~/.terminal-trading/` : il reste sur le Mac et hors du dépôt ; je n'en garde qu'une version anonymisée dans les tests |
| à la porte | ouvrir `PTF` et comparer la valeur affichée à celle de ton courtier |

## 10. Questions à trancher

| # | Question | Recommandation |
| --- | --- | --- |
| Q1 | Quel courtier tient le PEA, et quel export permet-il (opérations ou seulement positions) ? | partir de la position d'ouverture du Trading Desk ; ajouter l'historique si l'export le permet |
| Q2 | Quelles enveloppes en B1 ? | PEA seul en B1 ; CTO, assurance-vie et livrets ensuite, sur la même structure |
| Q3 | Point de départ des performances | date de l'import du Trading Desk, ou date du premier versement si l'export la donne |
| Q4 | Benchmarks | MSCI World (`CW8.PAR`), S&P 500 (`ESE.PAR`), CAC 40 (`CAC.PAR`) : 1 requête de plus par nuit |
| Q5 | Ventilation des ETF par pays et secteur | « Non ventilé » en B1 ; saisie depuis les fiches des émetteurs plus tard |

**Réponses de Clément (20/11/2026, T-038)** :
- Q1 : XTB ;
- Q2 : PEA seul, puis CTO ajouté après lecture des exports ;
- Q3 : performances depuis le 28/09/2026 ;
- Q4 : MSCI World et S&P 500, sans le CAC 40 ;
- Q5 : ventilation affichée, saisie depuis les fiches des émetteurs.
