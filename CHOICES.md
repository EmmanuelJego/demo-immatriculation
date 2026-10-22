# Choix de la démo

Ce fichier recense les simplifications faites pour ce projet de démonstration. Elles sont cohérentes avec son
périmètre, mais seraient probablement à revoir sur le vrai registre.

## Idempotence par clé naturelle uniquement

Chaque commande est dédupliquée par son contenu métier. Une création l'est par sa clé source, une fusion
par le couple survivant/absorbés, une scission par la répartition des clés sources.

En production : on ajouterait un header `Idempotency-Key` sur toutes les commandes, avec stockage de la réponse
et `422` si une même clé arrive avec un corps différent. Cela couvre les commandes sans clé naturelle évidente et
permet de rejouer une réponse à l'identique (y compris ses en-têtes).

## Fusion par absorption

Un projet survivant garde son immatriculation, les autres sont marqués `MERGED`.

## Scission : le projet source est clos

Une scission crée au moins deux nouveaux projets. Le projet source passe à `SPLIT`, et chacune de ses
clés sources est réattribuée à exactement un projet issu.

## Redirection exposée dans la ressource

Un projet absorbé reste consultable (`200`, `status: MERGED`, `mergedInto`). Il n'y a ni `301`/`308`
ni événement `Redirected` distinct, la redirection découlant de la fusion.

## Format d'immatriculation

`PRJ-XXXX-XXXX`, aléatoire, en Crockford Base32, avec une contrainte d'unicité en base et un nouveau
tirage en cas de collision.

## Création en conflit plutôt que mise à jour

Rejouer une création avec la même clé source mais des attributs différents renvoie `409`.

## Rejeu : seuls les attributs sont comparés

Le rejeu d'une immatriculation compare `label` et `ownerSiren` au projet qui possède la clé source, sans regarder son
statut. Si la clé a été transférée par une fusion, le rejeu de l'immatriculation d'origine renverra donc un conflit,
puisque les attributs du survivant diffèrent. C'est à revoir avec la fusion.

## Identifiant mal formé : `404`, pas `400`

`GET /v1/projects/{id}` répond `404` à un id qui n'a pas le format `PRJ-XXXX-XXXX` : aucun projet ne peut le porter.

## Rattachement : le projet en réponse, sans `Location`

`POST /v1/projects/{id}/source-keys` renvoie le projet complet avec `Content-Location: /v1/projects/{id}`, plutôt
qu'une ressource « clé source » : aucune route ne permet de consulter une clé seule, donc un `Location` vers elle
n'aurait pas de cible.

En production : selon les besoins des partenaires, une ressource `GET /v1/source-keys/{system}/{externalId}` (qui
résout une clé vers son projet) pourrait devenir la cible naturelle du `Location`.

## Concurrence : nombre de tentatives borné

Une commande qui perd une course sur une contrainte d'unicité est rejouée, trois fois au plus. Au-delà, elle échoue
en `500` générique. Il faudrait trois courses perdues d'affilée sur la même clé, ce qui n'arrive pas au volume d'un
registre.

En production : renvoyer un `409` ou un `503` avec `Retry-After`, pour que le client sache qu'il peut réessayer.

## Modèle de projet minimal

Un projet a seulement un `label` et un `ownerSiren`.

## Journal : `TRUNCATE` reste permis

Un trigger interdit l'`UPDATE` et le `DELETE` sur `project_events`, mais pas le `TRUNCATE`, dont les tests ont besoin pour remettre la base à zéro.

En production l'application tournerait avec un rôle PostgreSQL sans droit `TRUNCATE` (ni `UPDATE`/`DELETE`) sur le journal, et les migrations avec un rôle distinct.

## Journal : écritures sérialisées par un verrou global

Chaque `append` utilise un verrou de transaction, conservé jusqu'au commit.
Sans lui, une transaction longue qui a obtenu la `sequence` 10 pourrait commiter après une autre qui a obtenu la 11 :
un consommateur qui a déjà lu 11 avancerait son curseur et ne verrait jamais 10. Le verrou garantit que l'ordre des séquences suit l'ordre des commits, et que `occurredAt` suit le même ordre.

Le coût : toutes les commandes qui écrivent au journal sont sérialisées à partir de leur `append`.


## Hors périmètre

Authentification et autorisation des systèmes appelants, rate limiting, ETL et déduplication automatique, backfill
du stock existant, déploiement (Scalingo), observabilité.
