# Démo — Registre d'immatriculation des projets des collectivités

Projet de démonstration joint à ma candidature pour la mission freelance beta.gouv.fr
**« Software Engineer Senior — API d'immatriculation unique des projets »**
(API Projets Collectivités, DINUM × SGPE).

L'objectif n'est pas de reproduire le produit mais de montrer, sur un périmètre réduit, comment je structure
une API de ce type : modélisation métier, contrats d'interface, tests, et travail avec un agent de code.

## Périmètre

Un registre qui attribue à chaque projet de collectivité un **identifiant unique et pérenne**, et une API REST
versionnée pour l'alimenter et le consulter :

- **immatriculation** d'un projet à partir d'une clé source (système d'origine + identifiant dans ce système) ;
- **rattachement** de clés sources supplémentaires à un projet existant ;
- **fusion** de projets doublons (par absorption dans un projet survivant) ;
- **scission** d'un projet en plusieurs projets ;
- **journal d'événements** append-only qui trace chacune de ces actions.

Toutes les commandes sont **idempotentes** : rejouer une requête produit le même état et la même réponse, sauf 
en cas de modification de l'état de l'application entre temps.

## Stack

NestJS · TypeScript (ESM) · PostgreSQL · Drizzle · OpenAPI (`@nestjs/swagger`) · Vitest · Supertest · oxlint

## Comment ce dépôt est construit

- [CLAUDE.md](CLAUDE.md) : instructions pour l'agent de code (règles métier, méthodologie, conventions).
- [CHOICES.md](CHOICES.md) : simplifications assumées pour la démo, qui seraient à revoir sur un vrai projet.
- `.agents/skills/` : skills utilisées par l'agent (TDD, Vitest, NestJS, clean code, design d'API).

Le code est écrit en TDD, et chaque endpoint est couvert par des tests d'intégration qui tournent sur une vraie base PostgreSQL.

## Lancer le projet

Prérequis : Node 22, pnpm, Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up         # PostgreSQL de dev (:5442) et de test (:5443)
pnpm db:migrate    # migrations sur la base de dev
pnpm start:dev     # API sur http://localhost:3000, documentation OpenAPI sur /docs

pnpm test          # tests unitaires
pnpm test:e2e      # tests d'intégration API sur la base de test
pnpm lint          # oxlint
```
