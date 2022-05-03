import _ from 'lodash';
import { AmplienceHelper } from '../common/amplience-helper';
import { contextHandler } from '../common/middleware';
import amplienceBuilder from '../common/amplience-builder';
import { AmplienceContext } from '@lib/handlers/resource-handler';

export const command = 'publish';
export const desc = "Publish unpublished content items";

export const builder = amplienceBuilder
export const handler = contextHandler(async (context: AmplienceContext): Promise<void> => {
    await context.amplienceHelper.publishAll()
})