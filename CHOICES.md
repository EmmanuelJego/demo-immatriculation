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

`mergedInto` désigne le survivant au moment de la fusion, et n'est pas réécrit si ce survivant est absorbé à son tour.
Les redirections forment alors une chaîne (A → S → T) que le client suit jusqu'au projet `ACTIVE`. Rejouer la
fusion de A dans S répond alors `409`, puisque S n'est plus actif.

## Format d'immatriculation

`PRJ-XXXX-XXXX`, aléatoire, en Crockford Base32, avec une contrainte d'unicité en base et un nouveau
tirage en cas de collision.

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

## Création en conflit plutôt que mise à jour

Rejouer une création avec la même clé source mais des attributs différents renvoie `409`.

## Rejeu : seuls les attributs sont comparés, au projet d'origine de la clé

Chaque clé source garde le projet auquel elle a été rattachée en premier (`origin_project_id`), même quand une
fusion la transfère au survivant. Le rejeu d'une immatriculation compare `label` et `ownerSiren` à ce projet
d'origine, sans regarder son statut. Rejouer l'immatriculation d'un projet absorbé renvoie donc ce projet (`200`,
`status: MERGED`, `mergedInto`), et le client suit le lien vers le survivant.

Le rattachement, lui, regarde le propriétaire actuel de la clé : rattacher à un autre projet une clé transférée
est un conflit avec le survivant.

## Identifiant mal formé : `404`, pas `400`

`GET /v1/projects/{id}` répond `404` à un id qui n'a pas le format `PRJ-XXXX-XXXX` : aucun projet ne peut le porter.

## Fusion : un projet absorbé inconnu donne `422`, pas `404`

`404` est réservé à la ressource de l'URL, le survivant. Un absorbé inexistant est une erreur du corps de la
requête : `422` (`absorbed-project-not-found`), et rien n'est fusionné.

## Fusion : `200` dans tous les cas, au plus 100 absorbés

La fusion ne crée pas de ressource : elle répond `200` avec le survivant, qu'elle ait absorbé des projets ou que
tout ait déjà été absorbé (rejeu). Le client qui veut distinguer les deux cas lit le journal.

Une requête absorbe au plus 100 projets, pour borner le nombre de verrous qu'une commande peut prendre.

## Concurrence : nombre de tentatives borné

Une commande qui perd une course sur une contrainte d'unicité est rejouée, trois fois au plus. Au-delà, elle échoue
en `500`.

En production on pourrait renvoyer un `409` ou un `503` avec `Retry-After`, pour que le client sache qu'il peut réessayer.


## Hors périmètre

Authentification et autorisation des systèmes appelants, rate limiting, ETL et déduplication automatique, backfill
du stock existant, déploiement (Scalingo), observabilité.
