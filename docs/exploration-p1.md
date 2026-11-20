# Exploration P1 sur le Mac (étape E0, décision T-024)

Depuis l'environnement de développement, ni le BLS, ni Tree of Alpha, ni les banques centrales ne sont joignables. Ces scripts mesurent sur le Mac ce que le plan P1 marque « à mesurer ». Chaque script écrit dans `data/explore/` (ignoré par git) puis produit une archive `.zip` : la renvoyer dans la conversation. Les réponses reçues deviennent les fichiers de référence des tests.

Tout se lance depuis la racine du dépôt, avec le Python de la venv (`.venv/bin/python`, ou `python` une fois la venv activée). Aucune clé n'est nécessaire.

## 0. Préparer le `.env`

Ajouter dans le `.env` du Mac l'adresse e-mail **dédiée** au terminal (T-023) :

```
BLS_CONTACT_EMAIL=adresse-dediee@exemple.org
```

Le BLS bloque les robots qui ne donnent pas de contact : l'adresse part dans le User-Agent (« terminal-trading/0.1 (adresse) »), jamais ailleurs. Sans elle, `explore_bls.py` refuse de démarrer.

## 1. N'importe quel jour : sonde et flux RSS (5 minutes)

```bash
python scripts/explore_bls.py probe
python scripts/explore_news.py rss
```

- `probe` : une requête par adresse du BLS, 3 s d'écart, environ 20 requêtes (pages des communiqués, calendriers, requête conditionnelle).
- `rss` : une lecture de chacun des 15 flux (Fed, BCE, BoE, BoJ, BNS, BoC, RBA, RBNZ, FinancialJuice), 2 s d'écart.

Renvoyer les deux archives.

## 2. Jour de publication : rafale sur le rapport emploi du vendredi 04/12

Publication à 08:30 à New York, soit **14:30 à Paris**. Lancer avant **14:20**, Mac branché, et le laisser allumé jusqu'à 14:40 :

```bash
python scripts/explore_bls.py burst --event empsit --at "2026-12-04 08:30"
```

Dans un deuxième terminal, en même temps :

```bash
python scripts/explore_news.py watch --minutes 30
```

- Le script attend lui-même l'heure et empêche la veille (`caffeinate`) tant qu'il tourne.
- Une requête à T−10 min et à T−60 s, puis **une par seconde** de T−3 s à T+60 s, puis toutes les 10 s jusqu'à T+5 min : une centaine de requêtes en tout. Arrêt immédiat sur 403 ou 429.
- `--at` est l'heure **de New York**, pas celle de Paris.
- Mesure seule : aucun chiffre n'est lu ni affiché.

La rafale prévue sur le PPI du 13/11 n'a pas été lancée, et le BLS ne publie rien d'autre à 08:30 avant le 04/12 (T-035). Ne pas la relancer pendant la répétition du 08/12 ni pendant la porte du 10/12 : la capture du terminal interroge alors déjà le BLS.

## 3. Sur trois jours : Tree of Alpha seul

```bash
python scripts/explore_news.py watch --minutes 4320 --no-fj
```

Mesure le volume et le délai du flux gratuit de Tree of Alpha (T-021) avant tout abonnement. Le Mac peut se mettre en veille : le script se reconnecte et le note. `Ctrl+C` arrête le script plus tôt : l'archive est alors produite avec ce qui a été reçu.

## 4. Une fois : communiqués archivés

```bash
python scripts/explore_bls.py archives --event cpi --count 36
python scripts/explore_bls.py archives --event empsit --count 36
python scripts/explore_bls.py archives --event ppi --count 36
python scripts/explore_bls.py archives --event prod2 --count 12
```

Une page toutes les 5 s, environ 3 minutes par commande. `prod2` (productivité et coûts, trimestriel, 12 publications soit 3 ans) sert à la répétition du 08/12. Lancées le même jour, les quatre commandes remplissent le même dossier : l'archive produite par la dernière contient les quatre. Ces 36 derniers mois de communiqués forment le corpus du parseur (verbes réels, publications irrégulières de 2025-2026).

## 5. Page de test des voix

Avec le front lancé (`npm run dev` dans `web/`, ou le terminal en ligne), ouvrir `/outils/voix.html` dans le navigateur qui affichera le terminal :

1. « Activer voix et son » : un bip, puis « Voix activée ».
2. Pour chaque phrase, « Lire », puis « Juste » ou « Faux » selon ce qui a été entendu (signe moins, « pb », heure).
3. Essayer aussi « Dans 10 s » sur une phrase : c'est la lecture sans geste, celle du squawk.
4. « Copier le rapport » et coller le texte dans la conversation.

La page ne fait aucune requête réseau.

## Ce qui est renvoyé

| Étape | Archive | Sert à |
| --- | --- | --- |
| 1 | `data/explore/bls/<date>_probe.zip`, `data/explore/news/<date>_rss.zip` | en-têtes, cache, formats réels des flux |
| 2 | `data/explore/bls/<date>_burst_empsit.zip`, `data/explore/news/<date>_watch.zip` | délai réel de publication, comportement du cache, délai des fils d'actus |
| 3 | `data/explore/news/<date>_watch.zip` | volume et délai de Tree of Alpha |
| 4 | `data/explore/bls/<date>_archives.zip` | corpus du parseur |
| 5 | rapport JSON copié | choix des voix et normalisation des nombres pour le squawk |

## Résultats

### 20/11/2026 : lancés par Claude Code sur le Mac

- **Flux RSS** : les 15 flux répondent en HTTP 200. FinancialJuice renvoie 100 articles. RBA n'en renvoie qu'un seul, à revoir en E6. Archive : `data/explore/news/2026-11-20_rss.zip`.
- **Sonde du BLS** : toutes les adresses répondent en 200, en 50 à 600 ms, depuis le Mac avec l'adresse de contact dans le User-Agent. Les pages des communiqués (`*.nr0.htm`, `*.htm`) ne portent ni `Last-Modified` ni `ETag`, donc aucune requête conditionnelle n'est possible : la capture d'E3 relit la page entière (90 ko pour `cpi.nr0.htm`). L'API v1 répond `no-cache, no-store`.
- **Calendrier du BLS** : les dates relevées sur les pages `schedule/news_release/*.htm` sont rapport emploi le 04/12, productivité (révisée) le 08/12, CPI le 10/12 et PPI le 15/12, toutes à 08:30 à New York.
- **Communiqués archivés** : 36 pour le CPI, le rapport emploi et le PPI, et 12 pour la productivité, soit 120 pages. Archive : `data/explore/bls/2026-11-20_archives.zip`.
  - L'index de la productivité s'appelle `bls/news-release/prod.htm`, et non `prod2.htm` (404). Le script est corrigé.
  - L'index du rapport emploi publie déjà le lien du 04/12 (`empsit_12042026.htm`), qui répond 404 avant la publication.
- **Tree of Alpha** : écoute lancée le 20/11 à 16:01 pour 3 jours. Le Python de python.org n'a pas de magasin de certificats : sans `SSL_CERT_FILE` pointant vers `certifi`, la connexion `wss://` échoue (`CERTIFICATE_VERIFY_FAILED`). Le script s'en chargera lui-même en E1.
- **Encore à faire** : la rafale du 04/12 et la page de test des voix (§ 5).
