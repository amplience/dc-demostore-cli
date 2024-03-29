import { Cleanable, ResourceHandler, ImportContext, CleanupContext } from "./resource-handler"
import { SearchIndex, SearchIndexSettings, Webhook } from "dc-management-sdk-js"
import { paginator, searchIndexPaginator, replicaPaginator } from '../common/dccli/paginator'
import _ from 'lodash'
import logger, { logComplete, logUpdate } from "../common/logger"
import chalk from 'chalk'
import { prompts } from "../common/prompts"
import fs from 'fs-extra'
import async from 'async'

const retry = (count: number) => async (fn: () => Promise<any>, message: string) => {
    let retryCount = 0
    while (retryCount < count) {
        try {
            let runMessage = message
            if (retryCount > 0) {
                runMessage = runMessage + ` ` + chalk.red(`[ retry ${retryCount} ]`)
            }
            logUpdate(runMessage)
            return await fn()
        } catch (error) {
            if (error.response?.status === 504) {
                retryCount++
            }
            else if (error.response?.status === 409) {
                // occasionally, we will get a 409 here for an index that has been already inserted. we can ignore it, but log it
                logger.debug(`got a 409/conflict while running the command: ${message}`)                
                retryCount = count
            }
            else {
                throw error
            }
        }
    }
}
const retrier = retry(3)

const ensureSearchIndexSettings = (settings: unknown | SearchIndexSettings): SearchIndexSettings => {
    return settings instanceof SearchIndexSettings
        ? settings
        : new SearchIndexSettings(settings);
}

export class SearchIndexHandler extends ResourceHandler implements Cleanable {
    icon = '🔍'
    sortPriority = 1.09

    constructor() {
        super(SearchIndex, 'searchIndexes')
    }

    async import(context: ImportContext) {
        const { hub, mapping } = context

        let indexesFile = `${context.tempDir}/content/indexes/indexes.json`
        let publishedIndexes: SearchIndex[] = []
        if (!fs.existsSync(indexesFile)) {
            logger.info(`skipped, content/indexes/indexes.json not found`)
            return
        }
        else {
            let testIndexes = fs.readJsonSync(`${context.tempDir}/content/indexes/test-index.json`)
            let importIndexes = fs.readJsonSync(indexesFile)
    
            // const indexes = testIndexes.concat(importIndexes)
            const indexes = importIndexes
    
            let publishedIndexes = await paginator(searchIndexPaginator(hub))
            let unpublishedIndexes = _.filter(indexes, idx => !_.includes(_.map(publishedIndexes, 'name'), idx.indexDetails.name))
    
            let searchIndexCount = 0
            let replicaCount = 0
            let webhookCount = 0
    
            await async.eachSeries(unpublishedIndexes, async (item, callback) => {
                // Remove ID and replica count for creation
                delete item.indexDetails.id;
                delete item.indexDetails.replicaCount;
    
                let createdIndex = await retrier(() => hub.related.searchIndexes.create(item.indexDetails), `create index: ${chalk.cyanBright(item.indexDetails.name)}`)
                if (!createdIndex) {
                    throw new Error(`failed to create search index [ ${item.indexDetails.name} ] after 3 attempts`)
                }
                
                searchIndexCount++
    
                
                // reload published indexes
                publishedIndexes = await paginator(searchIndexPaginator(hub))
                
                // Get list of replicas settings
                const replicasSettings: any[] = item.replicasSettings;
                const replicasIndexes = _.map(replicasSettings, (item: any) => _.find(publishedIndexes, i => i.name === item.name))

                await retrier(
                    () => createdIndex.related.settings.update(ensureSearchIndexSettings(item.settings), {
                        waitUntilApplied: replicasIndexes.length > 0 ? ['replicas'] : false
                    }),
                    `apply settings: ${chalk.cyanBright(item.indexDetails.name)}`
                )

                await Promise.all(replicasIndexes.map(async (replicaIndex: SearchIndex, index: number) => {
                    await retrier(
                        () => replicaIndex.related.settings.update(ensureSearchIndexSettings(replicasSettings[index].settings)),
                        `apply replica settings: ${chalk.cyanBright(replicaIndex.name)}`
                    )
                    replicaCount++
                }))
    
                const types: any[] = await paginator(createdIndex.related.assignedContentTypes.list)
    
                // Get active and archive webhooks
                if (types.length > 0) {
                    const type = types[0];
    
                    const activeContentWebhookId = type._links['active-content-webhook'].href.split('/').slice(-1)[0];
                    const archivedContentWebhookId = type._links['archived-content-webhook'].href.split('/').slice(-1)[0];
    
                    const webhooks: any[] = await paginator(hub.related.webhooks.list)
                    const activeContentWebhook: Webhook = _.find(webhooks, hook => hook.id === activeContentWebhookId)
                    const archivedContentWebhook: Webhook = _.find(webhooks, hook => hook.id === archivedContentWebhookId)
    
                    if (activeContentWebhook && archivedContentWebhook) {
                        activeContentWebhook.customPayload = {
                            type: 'text/x-handlebars-template',
                            value: item.activeContentWebhook
                        }
                        await retrier(() => activeContentWebhook.related.update(activeContentWebhook), `update webhook: ${chalk.cyanBright(activeContentWebhook.label)}`)
                        webhookCount++
    
                        activeContentWebhook.customPayload = {
                            type: 'text/x-handlebars-template',
                            value: item.archivedContentWebhook
                        }
                        await retrier(() => archivedContentWebhook.related.update(archivedContentWebhook), `update webhook: ${chalk.cyanBright(archivedContentWebhook.label)}`)
                        webhookCount++
                    }
                }
                callback()
            })    

            logComplete(`${this.getDescription()}: [ ${chalk.green(searchIndexCount)} created ] [ ${chalk.green(replicaCount)} replicas created ] [ ${chalk.green(webhookCount)} webhooks created ]`)
        }

        publishedIndexes = await paginator(searchIndexPaginator(hub))

        // grab the algolia app key and id off of a search index
        const index = _.first(publishedIndexes)

        if (index) {
            let key = await index!.related.keys.get()
            if (key && key.applicationId && key.key) {

                if(!context.config){
                    let tempMapping = await context.amplienceHelper.getDemoStoreConfig()
                    context.config = tempMapping
                }
                context.config.algolia = {
                    appId: key.applicationId,
                    apiKey: key.key
                }
            }
        }
    }

    async cleanup(context: CleanupContext): Promise<any> {
        let searchIndexes: SearchIndex[] = await paginator(searchIndexPaginator(context.hub))

        let searchIndexCount = 0
        let replicaCount = 0
        await async.each(searchIndexes, (async (searchIndex: SearchIndex, callback) => {
            if (searchIndex.replicaCount && searchIndex.replicaCount > 0) {
                // get the replicas
                let replicas: SearchIndex[] = await paginator(replicaPaginator(searchIndex))
                await Promise.all(replicas.map(async (replica: SearchIndex) => {
                    await retrier(() => replica.related.delete(), `${prompts.delete} replica index ${chalk.cyan(replica.name)}...`)
                    replicaCount++
                }))
            }
            await retrier(() => searchIndex.related.delete(), `${prompts.delete} search index ${chalk.cyan(searchIndex.name)}...`)
            searchIndexCount++
            callback()
        }))

        logComplete(`${this.getDescription()}: [ ${chalk.red(searchIndexCount)} deleted ] [ ${chalk.red(replicaCount)} replicas deleted ]`)
    }
}