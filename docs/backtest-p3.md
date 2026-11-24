# Backtest du score de la heatmap (porte de P3)

Premier passage le 24/11/2026, tâche `backtest` de `p3-jobs` (code : `supabase/functions/p3-jobs/backtest.ts`, modèle : `score.ts`). Le résultat est enregistré dans `p3_state` (clé `backtest`) et recalculé le 2 de chaque mois.

## Méthode

- **Période** : chaque fin de mois de 2008-01 à 2026-08, soit 224 mois. Le rendement à 3 mois doit être connu, et la croissance demande 3 ans d'historique pour sa moyenne.
- **Score** : celui de l'écran, à la date de chaque fin de mois, calculé seulement avec les chiffres publiés à cette date :
  - délais de publication : IPC et chômage 1 mois après la fin de la période (chômage trimestriel 2 mois), PIB 2 mois, taux directeur sans délai ;
  - thèmes qui ont un historique : taux, inflation, croissance, emploi, sentiment. Le sentiment est retiré automatiquement : une seule économie (États-Unis) a une source libre, sous le seuil de 6 (T-058) ;
  - activité (PMI) et surprises : aucun historique, hors du backtest.
- **Rendement** : variation du change contre le dollar (FRED, H.10, dernier cours du mois), en log, moins la moyenne des 8 devises. Le dollar compte 0 avant centrage.
- **Mesures** :
  - corrélation de rang (IC de Spearman) entre le score, puis sa variation sur un mois, et le rendement relatif du mois suivant (h = 1) ou des 3 mois suivants (h = 3) ;
  - t de Newey-West avec h retards (les fenêtres de 3 mois se chevauchent) ;
  - écart moyen de rendement entre les 3 premières devises et les 3 dernières ;
  - stabilité sur les deux moitiés de la période.
- **Critère de la porte** : le score est « démontré » si l'IC de son niveau est positif avec t ≥ 2 sur chacune des deux moitiés, pour h = 1 ou h = 3.

## Résultat du 24/11/2026

| Horizon | Signal | IC moyen | t | Mois | Moitiés (IC ; t) | Top 3 − bottom 3 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 mois | niveau | +0,016 | 0,63 | 224 | 0,000 ; 0,00 / +0,032 ; 0,99 | +4,3 pb par mois |
| 1 mois | variation | −0,038 | −1,44 | 223 | −0,057 ; −1,59 / −0,019 ; −0,49 | −17 pb par mois |
| 3 mois | niveau | +0,020 | 0,55 | 224 | +0,019 ; 0,38 / +0,020 ; 0,39 | +0,7 pb par mois |
| 3 mois | variation | −0,003 | −0,13 | 223 | −0,036 ; −1,04 / +0,029 ; 0,77 | +7,4 pb par mois |

**Verdict : outil de contexte, non démontré comme signal.** Aucun IC n'est significatif. Les deux moitiés ne vont pas dans le même sens pour la variation du score, et l'écart entre les meilleures et les moins bonnes devises reste de l'ordre de quelques points de base par mois. L'écran l'affiche comme tel (T-053, plan P3). Le score ne doit pas servir à décider.

Le même code distingue bien un signal réel d'une absence de signal sur des données synthétiques (`backtest.test.ts`) : le résultat ci-dessus vient des données, pas de la méthode.

## Réserves

- **Chiffres révisés** : les sources donnent les chiffres d'aujourd'hui, pas ceux connus à l'époque. Le backtest est donc optimiste, et le résultat réel ne peut pas être meilleur.
- **Rendement de change seul** : sans le différentiel de taux (portage), qui favorise justement les devises à taux élevé.
- **Données manquantes** : IPC de la Nouvelle-Zélande (Stats NZ, clé non demandée) ; sentiment hors États-Unis ; IPC sous-jacent suisse.
- **Pondération égale** des thèmes, sans optimisation : choisir des poids sur ces mêmes données serait du surapprentissage.

## Suite

- Le backtest se relance le 2 de chaque mois.
- Le PMI et les surprises entrent dans le score après 3 mois de relevés (fin février 2027) et seront testés quand leur historique le permettra.
