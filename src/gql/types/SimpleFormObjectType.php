<?php

namespace anvildev\simpleform\gql\types;

use craft\gql\base\ObjectType;
use craft\gql\GqlEntityRegistry;
use GraphQL\Type\Definition\ObjectType as GraphQLObjectType;

/**
 * Base for Simple Form GraphQL object types: registers the type once with the
 * entity registry and wires its lazy field resolver, leaving subclasses to
 * declare only their name, description, and field definitions.
 *
 * Mirrors the pattern used by the sibling Beacon plugin.
 *
 * Craft 6's legacy GQL bridge (`CraftCms\Yii2Adapter\Gql\LegacyGqlTypes`)
 * requires every type registered through the old `EVENT_REGISTER_GQL_TYPES`
 * event to implement `CraftCms\Cms\Gql\Contracts\SingularTypeInterface`, or
 * the whole schema fails to build. That interface doesn't exist at all on
 * Craft 5, so `implements` can't reference it directly in a class
 * declaration this file defines unconditionally on both platforms — PHP
 * resolves an `implements` clause at class-load time, regardless of whether
 * the Craft-6-only bridge code that actually checks it ever runs. Declaring
 * the class twice, gated on `interface_exists()`, is the standard PHP
 * workaround: exactly one branch below ever executes, so the other's
 * reference to the interface is never resolved.
 *
 * @phpstan-type GqlFieldDefinition array{type: \GraphQL\Type\Definition\Type, description?: string, resolve?: callable, args?: array<string, mixed>}
 * @phpstan-type GqlFieldDefinitionMap array<string, GqlFieldDefinition>
 */
if (interface_exists(\CraftCms\Cms\Gql\Contracts\SingularTypeInterface::class)) {
    abstract class SimpleFormObjectType extends ObjectType implements \CraftCms\Cms\Gql\Contracts\SingularTypeInterface
    {
        abstract public static function getName(): string;

        abstract protected static function getDescription(): string;

        /** @return GqlFieldDefinitionMap */
        abstract public static function getFieldDefinitions(): array;

        public static function getType(): GraphQLObjectType
        {
            $class = static::class;

            return GqlEntityRegistry::getOrCreate(static::getName(), fn() => new $class([
                'name' => static::getName(),
                'fields' => $class . '::getFieldDefinitions',
                'description' => static::getDescription(),
            ]));
        }
    }
} else {
    abstract class SimpleFormObjectType extends ObjectType
    {
        abstract public static function getName(): string;

        abstract protected static function getDescription(): string;

        /** @return GqlFieldDefinitionMap */
        abstract public static function getFieldDefinitions(): array;

        public static function getType(): GraphQLObjectType
        {
            $class = static::class;

            return GqlEntityRegistry::getOrCreate(static::getName(), fn() => new $class([
                'name' => static::getName(),
                'fields' => $class . '::getFieldDefinitions',
                'description' => static::getDescription(),
            ]));
        }
    }
}
