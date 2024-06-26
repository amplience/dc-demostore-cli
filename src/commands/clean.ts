import {
  Cleanable,
  CleanupContext,
  ResourceHandler,
} from "../handlers/resource-handler";
import _ from "lodash";
import { Cleanables } from "../handlers";
import chalk from "chalk";
import async from "async";
import { Argv } from "yargs";
import { contextHandler } from "../common/middleware";
import amplienceBuilder from "../common/amplience-builder";
import { timed } from "../handlers/typed-result";
import {
  AUTOMATION_DIR_PATH,
  processAutomationTemplateFiles,
  setupAutomationTemplateFiles,
} from "../helpers/automation-helper";

const { Confirm, MultiSelect } = require("enquirer");

export const command = "cleanup";
export const desc = "Clean up hub";

export const builder = (yargs: Argv): Argv =>
  amplienceBuilder(yargs)
    .options({
      include: {
        alias: "i",
        describe: "types to include",
        type: "array",
      },
      skipConfirmation: {
        alias: "c",
        describe: "skip confirmation prompt",
        type: "boolean",
      },
      all: {
        alias: "a",
        describe: "clean up all resource types",
        type: "boolean",
      },
      content: {
        describe:
          "cleans up contentTypes, contentTypeSchema, contentItems with no confirmation",
        type: "boolean",
      },
      automationDir: {
        alias: "d",
        describe: "path to automation directory",
        default: AUTOMATION_DIR_PATH,
      },
      latest: {
        alias: "l",
        describe: "use latest automation files",
        type: "boolean",
      },
    })
    .middleware([
      async (context: CleanupContext) => {
        if (!!context.content) {
          context.skipConfirmation = true;
          context.include = [
            "contentTypes",
            "contentTypeSchema",
            "contentItems",
          ];
        }
        await setupAutomationTemplateFiles(context);
        await processAutomationTemplateFiles(context);
      },
    ]);

export const handler = contextHandler(
  async (context: CleanupContext): Promise<void> => {
    let choices: Cleanable[] = [];
    if (context.all) {
      choices = Cleanables;
    } else if (context.include) {
      choices = _.compact(
        _.map(context.include, (inc) =>
          _.find(
            Cleanables,
            (handler) => handler.resourceTypeDescription === inc,
          ),
        ),
      );
    } else {
      choices = await new MultiSelect({
        message: "select categories to clean",
        choices: _.map(Cleanables, (h: ResourceHandler) => ({
          name: h.getDescription(),
          value: h,
        })),
        result(names: string[]) {
          return this.map(names);
        },
      }).run();
    }

    // sort by import priority
    choices = _.sortBy(choices, "sortPriority");

    if (!context.skipConfirmation) {
      console.log(
        `${chalk.redBright("warning:")} this will perform the following actions on hub [ ${chalk.cyanBright(context.hub.name)} ]`,
      );
      _.each(choices, (choice: Cleanable) => {
        console.log(`\t* ${choice.getLongDescription()}`);
      });
    }

    if (
      context.skipConfirmation ||
      (await new Confirm({
        message: `${chalk.bold(chalk.greenBright("proceed?"))}`,
      }).run())
    ) {
      await async.eachSeries(choices, async (choice, callback) => {
        timed(`[ cleanup ] ${choice.resourceTypeDescription}`, async () => {
          await choice.cleanup(context);
          callback();
        });
      });
    }
  },
);
