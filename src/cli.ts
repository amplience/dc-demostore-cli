import Yargs from "yargs/yargs";
import YargsCommandBuilderOptions from "./common/yargs/yargs-command-builder-options";
import { Arguments, Argv } from "yargs";
import chalk from "chalk";

import logger from "./common/logger";
import _ from "lodash";
import { Context } from "./handlers/resource-handler";
import { currentEnvironment } from "./common/environment-manager";
import { setupLogging } from "./common/middleware";

const configureYargs = (yargInstance: Argv): Promise<Arguments> => {
  return new Promise(async (resolve): Promise<void> => {
    let failInvoked = false;
    const isYError = (err?: Error | string): boolean =>
      err instanceof Error && err.name === "YError";
    const failFn = (msg: string, err?: Error | string): void => {
      // fail should only be invoked once
      if (failInvoked) {
        return;
      }
      failInvoked = true;

      if ((msg && !err) || isYError(err)) {
        yargInstance.showHelp("error");
      } else if (err) {
        logger.error(chalk.red(err));
        process.exit(0);
      }
    };
    const argv = yargInstance
      .scriptName("demostore")
      .usage("Usage: $0 <command> [options]")
      .commandDir("./commands", YargsCommandBuilderOptions)
      .strict()
      .demandCommand(1, "Please specify at least one command")
      .exitProcess(false)
      .showHelpOnFail(false)
      .middleware([
        async (context: Context) => {
          context.startTime = new Date();
          logger.info(
            `run [ ${chalk.green(context._)} ]: started at ${context.startTime}`,
          );
          context.environment = await currentEnvironment();
        },
      ])
      .fail(failFn).argv;
    resolve(argv);
  });
};

export default async (
  yargInstance = Yargs(process.argv.slice(2)),
): Promise<Arguments | void> => {
  return await configureYargs(yargInstance);
};
