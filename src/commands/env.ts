import {
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  useEnvironmentFromArgs,
} from "../common/environment-manager";
import { Argv } from "yargs";
import _ from "lodash";

export const command = "env";
export const description = "Manage demostore environments";

export const envBuilder = (yargs: Argv): Argv =>
  yargs.positional("env", {
    describe: "env name",
    type: "string",
    demandOption: false,
  });

export const builder = (yargs: Argv): Argv =>
  yargs
    .demandCommand()
    .command("add", "Add an demostore environment", createEnvironment)
    .command(
      "delete [env]",
      "Delete an demostore environment",
      envBuilder,
      deleteEnvironment,
    )
    .command("list", "List demostore environments", listEnvironments)
    .command(
      "use [env]",
      "Use demostore environment",
      envBuilder,
      useEnvironmentFromArgs,
    )
    .help();
