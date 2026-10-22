# CLAUDE.md

Instructions pour l'agent de code travaillant sur ce dépôt. Contexte général : [README.md](README.md).
Simplifications assumées : [CHOICES.md](CHOICES.md). Les lire avant toute tâche.

## Commandes

```bash
pnpm db:up           # démarre PostgreSQL de dev (:5442) et de test (:5443) via docker compose
pnpm db:down         # arrête les conteneurs (la base de test, en mémoire, est perdue)
pnpm db:generate     # génère une migration depuis src/database/schema.ts
pnpm db:migrate      # applique les migrations sur la base de .env
pnpm test            # tests unitaires (src/**/*.spec.ts)
pnpm test:e2e        # tests d'intégration API (test/**/*.e2e-spec.ts), migre la base de test au démarrage
pnpm lint            # oxlint sur src/ et test/
pnpm format          # prettier
pnpm typecheck       # tsc --noEmit (inclut les tests, contrairement à build)
pnpm build           # compilation de src/
pnpm start:dev       # API en mode watch, doc OpenAPI sur http://localhost:3000/docs
```

Gestionnaire de paquets : **pnpm** uniquement. Node 22, projet **ESM** (`"type": "module"`) : les imports relatifs
prennent l'extension `.js` (`import { AppModule } from './app.module.js'`). Un type utilisé dans une signature
décorée s'importe avec `import type` (ou `type` inline), sinon `tsc` refuse (`isolatedModules` + `emitDecoratorMetadata`).

### Environnement

- `.env` (non versionné, copié depuis `.env.example`) : base de dev. Il est validé au démarrage par
  `src/config/environment.ts`, et toute nouvelle variable s'y déclare.
- `.env.test` (versionné) : base de test. Les tests e2e lisent **uniquement** ce fichier, jamais le shell, et
  `resetDatabase` refuse de vider une base dont le nom ne finit pas par `_test`.
- Helpers e2e dans `test/support/` : `createTestApp()` construit l'application avec `configureApp`, le même
  pipeline HTTP qu'en prod (versioning, validation, OpenAPI). `resetDatabase(app)` vide toutes les tables.
  `registerProject(app, registration?)` et `eventLog(app)` préparent et observent l'état via l'API.

## Notions métier

### Glossaire

La documentation est en français, le code (identifiants, routes, schémas, noms de tests) en anglais.
Utiliser **exactement** ces termes, sans synonymes.

| Métier (FR)                 | Code (EN)                              | Définition                                                                                     |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Registre                    | `Registry`                             | L'ensemble des projets immatriculés.                                                           |
| Projet                      | `Project`                              | Projet porté par une collectivité, identifié par son immatriculation.                          |
| Immatriculation             | `Project.id`                           | Identifiant unique, opaque et pérenne attribué par le registre. Jamais réutilisé ni modifié.   |
| Immatriculer                | `register`                             | Créer un projet dans le registre.                                                              |
| Intitulé                    | `label`                                | Libellé du projet.                                                                             |
| Collectivité porteuse       | `ownerSiren`                           | SIREN (9 chiffres) de la collectivité qui porte le projet.                                     |
| Clé source                  | `SourceKey { system, externalId }`     | Identifiant d'un projet dans un système tiers (guichet, démarche de financement…).             |
| Rattachement                | `attach` / `SourceKeyAttached`         | Association d'une clé source à un projet.                                                      |
| Fusion                      | `merge`                                | Absorption de projets doublons dans un projet survivant.                                       |
| Projet survivant            | `survivor`                             | Projet qui absorbe les autres lors d'une fusion et garde son immatriculation.                  |
| Projets absorbés            | `absorbed`                             | Projets qui disparaissent lors d'une fusion et redirigent vers le survivant.                   |
| Scission                    | `split`                                | Découpage d'un projet en plusieurs nouveaux projets.                                           |
| Projets issus               | `successors`                           | Projets créés par une scission.                                                                |
| Statut                      | `ProjectStatus`                        | `ACTIVE`, `MERGED` ou `SPLIT`.                                                                 |
| Journal                     | `EventLog` / `ProjectEvent`            | Historique append-only de toutes les actions sur le registre.                                  |

### Invariants

Ces règles sont la spécification. Chacune doit être couverte par au moins un test.

**Projet et immatriculation**
- L'immatriculation est générée par le serveur, au format `PRJ-XXXX-XXXX` (Crockford Base32, sans `I L O U`).
  Elle n'est jamais modifiée, réutilisée ni supprimée, même quand le projet est fusionné ou scindé.
- Seul un projet `ACTIVE` accepte des commandes (rattachement, fusion, scission). Les statuts `MERGED` et `SPLIT` sont terminaux.
- Un projet n'est jamais supprimé physiquement.

**Clé source et rattachement**
- Une clé source (`system` + `externalId`) appartient à **au plus un** projet à un instant donné (contrainte d'unicité en base).
- Un projet `ACTIVE` possède toujours au moins une clé source.
- Rattacher une clé source déjà rattachée au même projet ne change rien (rejeu). La rattacher alors qu'elle appartient
  à un autre projet est un conflit (`409`).
- Une clé source garde son **projet d'origine**, celui auquel elle a été rattachée en premier, même quand une fusion
  la transfère au survivant.

**Immatriculation (création)**
- La création exige une clé source initiale, qui sert de clé naturelle d'idempotence.
- Si la clé source existe déjà et que son projet d'origine a les mêmes attributs : on renvoie ce projet (`200`), sans
  nouvel événement, même s'il a été fusionné depuis.
- Si elle existe déjà avec des attributs différents : `409`.

**Fusion (par absorption)**
- Entrée : un survivant `S` (dans l'URL) et une liste non vide de projets absorbés `A`. `S ∉ A`, sinon `422`.
  Un projet de `A` inexistant : `422`.
- `S` et les projets de `A` à traiter doivent être `ACTIVE`.
- Effet : chaque projet absorbé passe à `MERGED`, porte `mergedInto = S`, et ses clés sources sont transférées à `S`.
  Un projet est `MERGED` si et seulement s'il porte `mergedInto` (`CHECK` en base).
- Idempotence : les projets de `A` déjà fusionnés dans `S` sont ignorés. S'il n'en reste aucun, on renvoie `S`
  sans nouvel événement. Si un projet de `A` est fusionné ailleurs ou scindé : `409`.
- Consulter un projet absorbé renvoie `200` avec `status: MERGED` et `mergedInto` : c'est la **redirection**.
  Les clients suivent ce lien. Aucune redirection HTTP n'est faite.

**Scission**
- Entrée : un projet source `P` et au moins 2 projets issus, chacun avec un `label`, un `ownerSiren` et au moins une clé source.
- Chaque clé source de `P` est attribuée à **exactement un** projet issu : une clé attribuée deux fois, ou une clé
  de `P` attribuée à aucun, est un `422`. Les projets issus peuvent aussi apporter de nouvelles clés sources, non
  rattachées ailleurs (sinon `409`).
- `P` doit être `ACTIVE`, sinon `409` (sauf rejeu, ci-dessous).
- Effet : `P` passe à `SPLIT` et porte `splitInto = [ids des projets issus]`. Les projets issus sont créés en `ACTIVE`.
  Un projet est `SPLIT` si et seulement s'il porte `splitInto`, d'au moins 2 projets (`CHECK` en base).
- Idempotence : si `P` est déjà `SPLIT` avec la même répartition des clés sources, on renvoie les projets issus
  existants (`200`) sans nouvel événement. Si la répartition diffère : `409`.
- Réponse : `{ source, successors }`, le projet source et les projets issus.

**Journal d'événements**
- Types : `ProjectRegistered`, `SourceKeyAttached`, `ProjectsMerged`, `ProjectSplit`.
- Chaque changement d'état écrit **son** événement **dans la même transaction**. Pas de changement d'état sans
  événement, et pas d'événement sans changement d'état.
- Le journal est **append-only** : jamais d'`UPDATE` ni de `DELETE`. C'est garanti en base, par un trigger, et pas seulement dans le code.
- Chaque événement porte un numéro de séquence global croissant (`sequence`), sa date (`occurredAt`), son type,
  les identifiants des projets concernés et un `payload` décrivant l'action.
- Un rejeu idempotent n'écrit **aucun** événement.

**Concurrence**
- Toute commande verrouille les projets concernés (`SELECT … FOR UPDATE`), **dans l'ordre croissant des identifiants**
  pour éviter les interblocages.

### API cible (v1)

Cette liste est indicative. Le contrat de référence est la spec OpenAPI générée.

| Méthode | Route                                         | Rôle                                               | Succès                       |
| ------- | --------------------------------------------- | -------------------------------------------------- | ---------------------------- |
| POST    | `/v1/projects`                                | Immatriculer un projet                             | `201` + `Location`, rejeu `200` |
| GET     | `/v1/projects/{id}`                           | Consulter un projet (quel que soit son statut)     | `200`                        |
| GET     | `/v1/projects?system=…&externalId=…`          | Retrouver un projet par clé source (liste paginée) | `200`                        |
| POST    | `/v1/projects/{id}/source-keys`               | Rattacher une clé source                           | `201`, rejeu `200`           |
| POST    | `/v1/projects/{id}/merges`                    | Absorber des projets dans `{id}`                   | `200`, rejeu `200`           |
| POST    | `/v1/projects/{id}/splits`                    | Scinder `{id}`                                     | `201`, rejeu `200`           |
| GET     | `/v1/projects/{id}/events`                    | Journal d'un projet                                | `200`                        |
| GET     | `/v1/events?after={sequence}&limit=…`         | Journal global, pagination par curseur             | `200`                        |

Hors périmètre : authentification, modification des attributs d'un projet, détachement d'une clé source,
annulation d'une fusion, déduplication automatique, ETL, backfill.

## Méthodologie

### TDD, toujours

Aucune ligne de code de production sans un test rouge qui la justifie. Suivre la skill `tdd`.

1. **Red** : écrire **un** test qui décrit **un** comportement à partir de l'interface publique, puis le voir échouer pour la bonne raison.
2. **Green** : écrire le code minimal qui le fait passer.
3. **Refactor** : nettoyer avec les tests au vert, puis repasser au test suivant.

Avancer par tranches verticales : un comportement traverse toutes les couches (contrôleur → use case → domaine → base)
avant de passer au suivant. Ne pas écrire tous les tests d'abord.

### Deux niveaux de tests, tous deux obligatoires

**Tests unitaires** (`src/**/*.spec.ts`, à côté du code)
- Ils ciblent le domaine : invariants, transitions de statut, règles de fusion et de scission, génération d'immatriculation.
- Le domaine est du TypeScript pur. Il ne mocke rien, car il n'a pas de dépendance.

**Tests d'intégration API** (`test/**/*.e2e-spec.ts`, avec Supertest)
- Ils démarrent l'application Nest complète (`AppModule`, mêmes pipes et filtres qu'en prod) et l'appellent en HTTP.
- Ils utilisent une **vraie base PostgreSQL de test**, jamais de mock du repository ou de Drizzle. La base est
  configurée par `.env.test` et migrée par le `globalSetup` avant la suite.
- L'application est créée une fois par fichier (`createTestApp()` en `beforeAll`), et chaque test part d'une base
  vide (`resetDatabase(app)` en `beforeEach`). Les fichiers e2e s'exécutent séquentiellement, car ils partagent la base.
- Pour chaque endpoint, couvrir au minimum : le cas nominal, la validation (`400`), la ressource inconnue (`404`),
  les conflits métier (`409`/`422`), le **rejeu idempotent** (même réponse, aucun événement en plus) et
  **l'événement écrit au journal**.
- Les assertions portent sur la réponse HTTP et sur l'état observable via l'API. Ne lire la base directement que
  pour vérifier ce que l'API n'expose pas.

Les noms de tests décrivent un comportement : `it('returns the existing project when the source key is replayed')`.

Une valeur utilisée à plusieurs endroits d'un test ou d'un fichier de test est déclarée **une seule fois** dans une
constante, et l'attendu y fait référence plutôt que de la réécrire. Cela vaut pour une donnée d'entrée reprise dans
l'assertion, une route, une taille de page, un message d'erreur… La constante est locale au test si elle ne sert qu'à
lui, et en tête de fichier (`UPPER_SNAKE_CASE`) sinon. Les valeurs fixées par le contrat (bornes, formats) restent
des littéraux du test et ne s'importent pas du code de production : sinon le test suivrait le code au lieu de le vérifier.

### Architecture

Un module Nest par fonctionnalité. Dépendances orientées vers le domaine :

```
src/
  projects/
    domain/           # entités, value objects, invariants, erreurs métier — sans import de Nest ni de Drizzle
    application/      # use cases (register, attach, merge, split), orchestration et transactions
    infrastructure/   # repositories Drizzle, implémentant les interfaces du domaine
    api/              # contrôleurs, DTOs d'entrée/sortie, mapping des erreurs
  events/             # journal : écriture (dans la transaction de la commande) et lecture
  database/           # schéma Drizzle, client, module, migrations
  common/             # transverse : Problem Details (http/), pagination par curseur (pagination/)
```

- **Commandes et transactions** : un use case passe **uniquement** par l'`UnitOfWork`
  (`src/projects/application/unit-of-work.ts`). `run(async ({ projects, events }) => …)` ouvre une transaction et
  fournit les repositories et le journal liés à celle-ci : aucune écriture n'est possible hors de la transaction.
  Les adapters reçoivent un `DatabaseExecutor` (base ou transaction), et seule `DrizzleUnitOfWork` les instancie.
- **Écrire au journal** : `events.append(event)`. `append` prend un verrou global gardé jusqu'au commit (voir
  CHOICES.md) : l'appeler **en dernier** dans la transaction, après les verrous `FOR UPDATE` sur les projets. L'ordre
  des verrous est alors toujours le même, sans interblocage, et le verrou est tenu le moins longtemps possible.
  Chaque événement est typé dans le domaine qui le produit, et étend `NewEvent` (par exemple `ProjectRegistered`
  dans `src/projects/domain/project.ts`). Ses payloads sont des `type`, pas des `interface`, pour rester compatibles
  avec `JsonObject`.
- **Erreurs métier** : les classes étendent `DomainError` (`src/common/errors/`) avec un `code` (qui donne le `type`
  Problem Details `urn:immatriculation:problem:<code>`) et un `kind` (`not-found` → 404, `conflict` → 409,
  `invalid` → 422).
- **Concurrence** :
  - une commande sur un projet existant le charge par `projects.findByIdForUpdate(id)`, qui le verrouille jusqu'au commit ;
    une commande sur plusieurs projets les charge **en une fois** par `projects.findManyByIdForUpdate(ids)`, qui les
    verrouille dans l'ordre croissant des ids, quel que soit l'ordre demandé ;
  - un repository traduit les violations d'unicité PostgreSQL en erreurs de son contrat (`DuplicateSourceKey`,
    `DuplicateProjectId`), et le use case enveloppe son unit of work dans `retryOnDuplicate(() => …)`
    (`src/projects/application/retry.ts`), qui la rejoue entière, un nombre borné de fois ;
  - les tests de concurrence sont déterministes (`test/support/concurrency.ts`) : `contendWith(db, holder, contender)`
    tient la transaction `holder` ouverte jusqu'à ce que `contender` soit réellement bloqué derrière elle
    (`waitForLockWait`, via `pg_stat_activity`), puis la commite. Un 4ᵉ argument optionnel, `whileBlocked`, observe
    l'état pendant l'attente (par exemple les verrous déjà pris). Jamais de `Promise.all` en espérant une course, ni
    d'attente fixe (`setTimeout`).
- **Lister** : `CursorPageQuery` en `@Query()`, lecture de `limit + 1` lignes puis `toPage()` (`src/common/pagination/`),
  réponse `{ data, pagination: { after, limit, nextAfter } }`.

- Les repositories sont exposés par des interfaces et injectés par token (skill `nestjs-best-practices`).
- Un use case ouvre **une seule** transaction, qui couvre le changement d'état et l'écriture de l'événement.
- Le domaine lève des erreurs métier typées. Un exception filter les traduit en réponses HTTP. Pas de
  `HttpException` dans le domaine.
- Clean code (skill `clean-code`) : fonctions courtes, noms explicites, pas de commentaire qui paraphrase le code,
  données immuables (on renvoie de nouveaux objets au lieu de muter).

### Persistance (Drizzle + PostgreSQL)

- Le schéma est décrit en TypeScript dans `src/database/`. Les migrations sont générées par `drizzle-kit`, versionnées,
  et **jamais modifiées une fois commitées**.
- Les contraintes métier sont aussi portées par la base : unicité de `(system, external_id)`, `CHECK` sur les statuts,
  clés étrangères, trigger append-only sur le journal.
- Pas de requête N+1 : charger un projet avec ses clés sources en une requête ou en un lot.

### Design de l'API

Suivre les skills `api-and-interface-design` et `nestjs-best-practices`.

- **RESTful** : ressources au pluriel et en kebab-case, verbes HTTP sémantiques, codes de statut exacts.
  Les commandes métier (fusion, scission) sont des sous-ressources en `POST`.
- **Versionnée** dans l'URI (`VersioningType.URI`, préfixe `/v1`). Un changement incompatible impose une nouvelle version.
- **Contrats explicites** : chaque endpoint a un DTO d'entrée (validé par `class-validator` via un `ValidationPipe`
  global en `whitelist` + `forbidNonWhitelisted`) et un DTO de sortie. On ne renvoie jamais une ligne Drizzle ni
  une entité du domaine telle quelle.
- **OpenAPI** : chaque DTO et chaque contrôleur est documenté avec `@nestjs/swagger` (`@ApiProperty`, `@ApiOkResponse`,
  `@ApiConflictResponse`…), y compris les réponses d'erreur. La spec est servie sur `/docs` (JSON sur `/docs-json`).
  Elle constitue le contrat : toute évolution de l'API passe par elle.
- **Erreurs** au format Problem Details (RFC 9457, `application/problem+json`) : `type`, `title`, `status`,
  `detail`, et `errors: [{ field, messages }]` pour la validation. Le `ProblemDetailsFilter` global les produit à
  partir de toute exception (`src/common/http/`). Chaque réponse d'erreur se documente avec
  `@ApiProblemResponse(HttpStatus.X, '…')`.
  - `400` : requête mal formée ou invalide (schéma).
  - `404` : ressource inconnue.
  - `409` : conflit avec l'état du registre (projet non `ACTIVE`, clé source déjà rattachée ailleurs, rejeu divergent).
  - `422` : requête bien formée mais impossible à traiter : incohérente en elle-même (survivant parmi les absorbés,
    clé source non répartie), ou désignant dans son corps un projet qui n'existe pas.
- **Champs texte** : en plus de leurs bornes, ils refusent U+0000, que PostgreSQL ne sait pas stocker (sinon `500`).
- **Pagination** des listes par curseur (`after`, `limit`, avec un plafond).
- Dates en ISO 8601 UTC. Champs JSON en camelCase.

### Définition de « terminé »

Une tâche n'est terminée que si :

1. les tests ont été écrits avant le code, et `pnpm test` et `pnpm test:e2e` passent ;
2. `pnpm lint` ne remonte rien, et `pnpm format` a été lancé ;
3. `pnpm typecheck` et `pnpm build` passent ;
4. la spec OpenAPI reflète le comportement réel, y compris les erreurs ;
5. toute nouvelle simplification propre à la démo est ajoutée dans [CHOICES.md](CHOICES.md) ;
6. le commit suit les Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`).

Lancer le linter **après chaque tâche**, sans attendre la fin d'une série.

### Git

Ne commit pas sans qu'on te l'ai explicitement demandé.