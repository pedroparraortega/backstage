/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useHotCleanup } from '@backstage/backend-common';
import { DefaultCatalogCollatorFactory } from '@backstage/plugin-catalog-backend';
import { createRouter } from '@backstage/plugin-search-backend';
import { ElasticSearchSearchEngine } from '@backstage/plugin-search-backend-module-elasticsearch';
import { PgSearchEngine } from '@backstage/plugin-search-backend-module-pg';
import {
  IndexBuilder,
  LunrSearchEngine,
  SearchEngine,
} from '@backstage/plugin-search-backend-node';
import { DefaultTechDocsCollatorFactory } from '@backstage/plugin-techdocs-backend';
import { Router } from 'express';
import { PluginEnvironment } from '../types';

async function createSearchEngine(
  env: PluginEnvironment,
): Promise<SearchEngine> {
  if (env.config.has('search.elasticsearch')) {
    return await ElasticSearchSearchEngine.fromConfig({
      logger: env.logger,
      config: env.config,
    });
  }

  if (await PgSearchEngine.supported(env.database)) {
    return await PgSearchEngine.from({ database: env.database });
  }

  return new LunrSearchEngine({ logger: env.logger });
}

export default async function createPlugin(
  env: PluginEnvironment,
): Promise<Router> {
  // Initialize a connection to a search engine.
  const searchEngine = await createSearchEngine(env);
  const indexBuilder = new IndexBuilder({
    logger: env.logger,
    searchEngine,
  });

  // Collators are responsible for gathering documents known to plugins. This
  // particular collator gathers entities from the software catalog.
  indexBuilder.addCollator({
    defaultRefreshIntervalSeconds: 600,
    factory: DefaultCatalogCollatorFactory.fromConfig(env.config, {
      discovery: env.discovery,
      tokenManager: env.tokenManager,
    }),
  });

  indexBuilder.addCollator({
    defaultRefreshIntervalSeconds: 600,
    factory: DefaultTechDocsCollatorFactory.fromConfig(env.config, {
      discovery: env.discovery,
      logger: env.logger,
      tokenManager: env.tokenManager,
    }),
  });

  // The scheduler controls when documents are gathered from collators and sent
  // to the search engine for indexing.
  const { scheduler } = await indexBuilder.build();

  // A 3 second delay gives the backend server a chance to initialize before
  // any collators are executed, which may attempt requests against the API.
  setTimeout(() => scheduler.start(), 3000);
  useHotCleanup(module, () => scheduler.stop());

  return await createRouter({
    engine: indexBuilder.getSearchEngine(),
    types: indexBuilder.getDocumentTypes(),
    permissions: env.permissions,
    config: env.config,
    logger: env.logger,
  });
}
