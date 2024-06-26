import { ContentItem, ContentRepository } from "dc-management-sdk-js";
import { ContentMapping } from "../content-mapping";
import { Body } from "./body";

type DependencyContentTypeSchema =
  | "http://bigcontent.io/cms/schema/v1/core#/definitions/content-link"
  | "http://bigcontent.io/cms/schema/v1/core#/definitions/content-reference"
  | "_hierarchy"; // Used internally for parent dependencies.

export interface RepositoryContentItem {
  repo: ContentRepository;
  content: ContentItem;
}

export interface ContentDependency {
  _meta: { schema: DependencyContentTypeSchema; name: string };
  contentType: string;
  id: string | undefined;
}

export interface ContentDependencyInfo {
  resolved?: ItemContentDependencies;
  dependency: ContentDependency;
  owner: RepositoryContentItem;

  parent?: RecursiveSearchStep;
  index: string | number;
}

export interface ItemContentDependencies {
  owner: RepositoryContentItem;
  dependencies: ContentDependencyInfo[];
  dependents: ContentDependencyInfo[];
}

export interface ContentDependencyLayer {
  items: ItemContentDependencies[];
}

export const referenceTypes = [
  "http://bigcontent.io/cms/schema/v1/core#/definitions/content-link",
  "http://bigcontent.io/cms/schema/v1/core#/definitions/content-reference",
];

enum CircularDependencyStage {
  Standalone = 0,
  Intertwined,
  Parent,
}

type RecursiveSearchStep = Body | ContentDependency | Array<Body>;

export class ContentDependencyTree {
  levels: ContentDependencyLayer[];
  circularLinks: ItemContentDependencies[];
  all: ItemContentDependencies[];
  byId: Map<string, ItemContentDependencies>;
  requiredSchema: string[];

  constructor(items: RepositoryContentItem[], mapping: ContentMapping) {
    // Identify all content dependencies.
    let info = this.identifyContentDependencies(items);
    const allInfo = info;
    this.resolveContentDependencies(info);

    const requiredSchema = new Set<string>();
    info.forEach((item) => {
      requiredSchema.add(item.owner.content.body._meta.schema);
    });

    // For each stage, add all content that has no dependencies resolved in a previous stage
    const resolved = new Set<string>();
    mapping.contentItems.forEach((to, from) => {
      resolved.add(from);
    });

    let unresolvedCount = info.length;

    const stages: ContentDependencyLayer[] = [];
    while (unresolvedCount > 0) {
      const stage: ItemContentDependencies[] = [];
      const lastUnresolvedCount = unresolvedCount;
      info = info.filter((item) => {
        const unresolvedDependencies = item.dependencies.filter(
          (dep) => !resolved.has(dep.dependency.id as string),
        );

        if (unresolvedDependencies.length === 0) {
          stage.push(item);
          return false;
        }

        return true;
      });

      stage.forEach((item) => {
        resolved.add(item.owner.content.id as string);
      });

      unresolvedCount = info.length;
      if (unresolvedCount === lastUnresolvedCount) {
        break;
      }

      stages.push({ items: stage });
    }

    // Remaining items in the info array are connected to circular dependencies, so must be resolved via rewriting.

    // Create dependency layers for circular dependencies

    const circularStages: ItemContentDependencies[][] = [];
    while (unresolvedCount > 0) {
      const stage: ItemContentDependencies[] = [];

      // To be in this stage, the circular dependency must contain no other circular dependencies (before self-loop).
      // The circular dependencies that appear before self loop are
      const lastUnresolvedCount = unresolvedCount;
      const circularLevels = info.map((item) =>
        this.topLevelCircular(item, info),
      );

      const chosenLevel = Math.min(
        ...circularLevels,
      ) as CircularDependencyStage;

      for (let i = 0; i < info.length; i++) {
        const item = info[i];
        if (circularLevels[i] === chosenLevel) {
          stage.push(item);
          circularLevels.splice(i, 1);
          info.splice(i--, 1);
        }
      }

      unresolvedCount = info.length;
      if (unresolvedCount === lastUnresolvedCount) {
        break;
      }

      circularStages.push(stage);
    }

    this.levels = stages;
    this.circularLinks = [];
    circularStages.forEach((stage) => this.circularLinks.push(...stage));

    this.all = allInfo;
    this.byId = new Map(
      allInfo.map((info) => [info.owner.content.id as string, info]),
    );
    this.requiredSchema = Array.from(requiredSchema);
  }

  private searchObjectForContentDependencies(
    item: RepositoryContentItem,
    body: RecursiveSearchStep,
    result: ContentDependencyInfo[],
    parent: RecursiveSearchStep | undefined,
    index: string | number,
  ): void {
    if (Array.isArray(body)) {
      body.forEach((contained, index) => {
        this.searchObjectForContentDependencies(
          item,
          contained,
          result,
          body,
          index,
        );
      });
    } else if (body != null) {
      const allPropertyNames = Object.getOwnPropertyNames(body);
      // Does this object match the pattern expected for a content item or reference?
      if (
        body._meta &&
        referenceTypes.indexOf(body._meta.schema) !== -1 &&
        typeof body.contentType === "string" &&
        typeof body.id === "string"
      ) {
        result.push({
          dependency: body as ContentDependency,
          owner: item,
          parent,
          index,
        });
        return;
      }

      allPropertyNames.forEach((propName) => {
        const prop = (body as Body)[propName];
        if (typeof prop === "object") {
          this.searchObjectForContentDependencies(
            item,
            prop,
            result,
            body,
            propName,
          );
        }
      });
    }
  }

  public removeContentDependenciesFromBody(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any,
    remove: object[],
  ): void {
    if (Array.isArray(body)) {
      for (let i = 0; i < body.length; i++) {
        if (remove.indexOf(body[i]) !== -1) {
          body.splice(i--, 1);
        } else {
          this.removeContentDependenciesFromBody(body[i], remove);
        }
      }
    } else {
      const allPropertyNames = Object.getOwnPropertyNames(body);

      allPropertyNames.forEach((propName) => {
        const prop = body[propName];
        if (remove.indexOf(prop) !== -1) {
          delete body[propName];
        } else if (typeof prop === "object") {
          this.removeContentDependenciesFromBody(prop, remove);
        }
      });
    }
  }

  private topLevelCircular(
    top: ItemContentDependencies,
    unresolved: ItemContentDependencies[],
  ): CircularDependencyStage {
    let selfLoop = false;
    let intertwinedLoop = false;
    let isParent = false;
    const seenBefore = new Set<ItemContentDependencies>();

    const traverse = (
      top: ItemContentDependencies,
      item: ItemContentDependencies | undefined,
      depth: number,
      unresolved: ItemContentDependencies[],
      seenBefore: Set<ItemContentDependencies>,
      intertwined: boolean,
    ): boolean => {
      let hasCircular = false;

      if (item == null) {
        return false;
      } else if (top === item && depth > 0) {
        selfLoop = true;
        return false;
      } else if (top !== item && unresolved.indexOf(item) !== -1) {
        // Contains a circular dependency.

        if (!intertwined) {
          // Does it loop back to the parent?
          const storedSelfLoop = selfLoop;
          const childIntertwined = traverse(
            item,
            item,
            0,
            [top],
            new Set<ItemContentDependencies>(),
            true,
          );
          selfLoop = storedSelfLoop;

          if (childIntertwined) {
            intertwinedLoop = true;
          } else {
            // We're the parent of a non-intertwined circular loop.
            isParent = true;
          }
        }

        hasCircular = true;
      }

      if (seenBefore.has(item)) {
        return false;
      }

      seenBefore.add(item);

      item.dependencies.forEach((dep) => {
        hasCircular =
          traverse(
            top,
            dep.resolved,
            depth + 1,
            unresolved,
            seenBefore,
            intertwined,
          ) || hasCircular;
      });

      return hasCircular;
    };

    const hasCircular = traverse(top, top, 0, unresolved, seenBefore, false);

    if (hasCircular) {
      if (intertwinedLoop) {
        if (selfLoop && !isParent) {
          return CircularDependencyStage.Intertwined;
        } else {
          return CircularDependencyStage.Parent;
        }
      } else {
        return CircularDependencyStage.Parent;
      }
    } else {
      return CircularDependencyStage.Standalone;
    }
  }

  private identifyContentDependencies(
    items: RepositoryContentItem[],
  ): ItemContentDependencies[] {
    return items.map((item) => {
      const result: ContentDependencyInfo[] = [];
      this.searchObjectForContentDependencies(
        item,
        item.content.body,
        result,
        undefined,
        0,
      );

      // Hierarchy parent is also a dependency.
      if (
        item.content.body._meta.hierarchy &&
        item.content.body._meta.hierarchy.parentId
      ) {
        result.push({
          dependency: {
            _meta: {
              schema: "_hierarchy",
              name: "_hierarchy",
            },
            id: item.content.body._meta.hierarchy.parentId,
            contentType: "",
          },
          owner: item,
          parent: undefined,
          index: 0,
        });
      }

      return { owner: item, dependencies: result, dependents: [] };
    });
  }

  private resolveContentDependencies(items: ItemContentDependencies[]): void {
    // Create cross references to make it easier to traverse dependencies.

    const idMap = new Map(
      items.map((item) => [item.owner.content.id as string, item]),
    );
    const visited = new Set<ItemContentDependencies>();

    const resolve = (item: ItemContentDependencies): void => {
      if (visited.has(item)) return;
      visited.add(item);

      item.dependencies.forEach((dep) => {
        const target = idMap.get(dep.dependency.id as string);
        dep.resolved = target;
        if (target) {
          target.dependents.push({
            owner: target.owner,
            resolved: item,
            dependency: dep.dependency,
            parent: dep.parent,
            index: dep.index,
          });
          resolve(target);
        }
      });
    };

    items.forEach((item) => resolve(item));
  }

  public traverseDependents(
    item: ItemContentDependencies,
    action: (item: ItemContentDependencies) => void,
    ignoreHier = false,
    traversed?: Set<ItemContentDependencies>,
  ): void {
    const traversedSet = traversed || new Set<ItemContentDependencies>();
    traversedSet.add(item);
    action(item);
    item.dependents.forEach((dependent) => {
      if (ignoreHier && dependent.dependency._meta.schema == "_hierarchy") {
        return;
      }

      const resolved = dependent.resolved as ItemContentDependencies;
      if (!traversedSet.has(resolved)) {
        this.traverseDependents(resolved, action, ignoreHier, traversedSet);
      }
    });
  }

  public filterAny(
    action: (item: ItemContentDependencies) => boolean,
  ): ItemContentDependencies[] {
    return this.all.filter((item) => {
      let match = false;
      this.traverseDependents(item, (item) => {
        if (action(item)) {
          match = true;
        }
      });
      return match;
    });
  }

  public removeContent(items: ItemContentDependencies[]): void {
    this.levels.forEach((level) => {
      level.items = level.items.filter((item) => items.indexOf(item) === -1);
    });

    this.all = this.all.filter((item) => items.indexOf(item) === -1);
    this.circularLinks = this.circularLinks.filter(
      (item) => items.indexOf(item) === -1,
    );

    items.forEach((item) => {
      this.byId.delete(item.owner.content.id as string);
    });
  }
}
