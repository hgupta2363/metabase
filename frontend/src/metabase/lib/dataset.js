/* @flow */

import _ from "underscore";

import type {
  Value,
  Column,
  ColumnName,
  DatasetData,
} from "metabase/meta/types/Dataset";
import type { Field as FieldReference } from "metabase/meta/types/Query";

import StructuredQuery from "metabase-lib/lib/queries/StructuredQuery";
import Dimension from "metabase-lib/lib/Dimension";

type ColumnSetting = {
  name: ColumnName,
  fieldRef?: FieldReference,
  enabled: boolean,
};

// Many aggregations result in [[null]] if there are no rows to aggregate after filters
export const datasetContainsNoResults = (data: DatasetData): boolean =>
  data.rows.length === 0 || _.isEqual(data.rows, [[null]]);

/**
 * @returns min and max for a value in a column
 */
export const rangeForValue = (
  value: Value,
  column: ?Column,
): ?[number, number] => {
  if (
    typeof value === "number" &&
    column &&
    column.binning_info &&
    column.binning_info.bin_width
  ) {
    return [value, value + column.binning_info.bin_width];
  }
};

/**
 * Returns a MBQL field reference (FieldReference) for a given result dataset column
 *
 * NOTE: this returns non-normalized ["fk->", 1, 2] style fk field references
 * which is unfortunately used in table.columns visualization_settings
 *
 * @param  {Column} column Dataset result column
 * @param  {?Column[]} columns Full array of columns, unfortunately needed to determine the aggregation index
 * @return {?FieldReference} MBQL field reference
 */
export function fieldRefForColumn(
  column: Column,
  columns?: Column[],
): ?FieldReference {
  if (column.id != null) {
    if (Array.isArray(column.id)) {
      // $FlowFixMe: sometimes col.id is a field reference (e.x. nested queries), if so just return it
      return column.id;
    } else if (column.fk_field_id != null) {
      return ["fk->", column.fk_field_id, column.id];
    } else {
      return ["field-id", column.id];
    }
  } else if (column.expression_name != null) {
    return ["expression", column.expression_name];
  } else if (column.source === "aggregation" && columns) {
    // HACK: find the aggregation index, preferably this would be included on the column
    const aggIndex = columns
      .filter(c => c.source === "aggregation")
      .indexOf(column);
    if (aggIndex >= 0) {
      return ["aggregation", aggIndex];
    }
  }
  return null;
}

export const keyForColumn = (column: Column): string => {
  const ref = fieldRefForColumn(column);
  return JSON.stringify(ref ? ["ref", ref] : ["name", column.name]);
};

/**
 * Finds the column object from the dataset results for the given `table.columns` column setting
 * @param  {Column[]} columns             Dataset results columns
 * @param  {ColumnSetting} columnSetting  A "column setting" from the `table.columns` settings
 * @return {?Column}                      A result column
 */
export function findColumnForColumnSetting(
  columns: Column[],
  columnSetting: ColumnSetting,
): ?Column {
  const index = findColumnIndexForColumnSetting(columns, columnSetting);
  if (index >= 0) {
    return columns[index];
  } else {
    return null;
  }
}

function normalizeFieldRef(fieldRef: ?FieldReference): ?FieldReference {
  const dimension = Dimension.parseMBQL(fieldRef);
  return dimension && dimension.mbql();
}

export function findColumnIndexForColumnSetting(
  columns: Column[],
  columnSetting: ColumnSetting,
): number {
  // NOTE: need to normalize field refs because they may be old style [fk->, 1, 2]
  const fieldRef = normalizeFieldRef(columnSetting.fieldRef);
  // first try to find by fieldRef
  if (fieldRef != null) {
    const index = _.findIndex(columns, col =>
      _.isEqual(fieldRef, normalizeFieldRef(fieldRefForColumn(col))),
    );
    if (index >= 0) {
      return index;
    }
  }
  // if that fails, find by column name
  return _.findIndex(columns, col => col.name === columnSetting.name);
}

export function syncTableColumnsToQuery(question) {
  let query = question.query();
  const columnSettings = question.settings()["table.columns"];
  if (columnSettings && query instanceof StructuredQuery) {
    // clear `fields` first
    query = query.clearFields();
    const columnDimensions = query.columnDimensions();
    const columnNames = query.columnNames();
    for (const columnSetting of columnSettings) {
      if (columnSetting.enabled) {
        if (columnSetting.fieldRef) {
          query = query.addField(columnSetting.fieldRef);
        } else if (columnSetting.name) {
          const index = _.findIndex(
            columnNames,
            name => name === columnSetting.name,
          );
          if (index >= 0) {
            query = query.addField(columnDimensions[index].mbql());
          } else {
            console.warn("Unknown column", columnSetting);
          }
        } else {
          console.warn("Unknown column", columnSetting);
        }
      }
    }
    // if removing `fields` wouldn't change the resulting columns, just remove it
    const newColumnDimensions = query.columnDimensions();
    if (
      columnDimensions.length === newColumnDimensions.length &&
      _.all(columnDimensions, (d, i) =>
        d.isSameBaseDimension(newColumnDimensions[i]),
      )
    ) {
      return query.clearFields().question();
    } else {
      return query.question();
    }
  }
  return question;
}
