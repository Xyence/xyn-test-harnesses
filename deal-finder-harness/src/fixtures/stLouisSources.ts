export type StLouisSourceKind = "file_backed" | "service_geocoder";

export interface StLouisSourceFixture {
  readonly fixtureId: string;
  readonly kind: StLouisSourceKind;
  readonly baseKey: string;
  readonly baseName: string;
  readonly sourceType: string;
  readonly sourceMode: "manual" | "remote_url";
  readonly parserKind: string;
  readonly refreshCadenceSeconds: number;
  readonly locationUrl: string;
  readonly metadata: Record<string, unknown>;
  readonly configuration: Record<string, unknown>;
}

const STL_BASE = "https://data.stlouis-mo.gov/deal-finder";

export const ST_LOUIS_SOURCE_FIXTURES: Record<string, StLouisSourceFixture> = {
  current_parcels_shapefile: {
    fixtureId: "current_parcels_shapefile",
    kind: "file_backed",
    baseKey: "stl-current-parcels-shapefile",
    baseName: "St. Louis Current Parcels Shapefile",
    sourceType: "parcel_boundaries",
    sourceMode: "remote_url",
    parserKind: "shapefile",
    refreshCadenceSeconds: 7 * 24 * 60 * 60,
    locationUrl: `${STL_BASE}/parcels/current_parcels.zip`,
    metadata: {
      city: "St. Louis",
      domain: "parcel",
      format: "shapefile",
      canonical_fixture: true,
    },
    configuration: {
      url: `${STL_BASE}/parcels/current_parcels.zip`,
      parser_kind: "shapefile",
      geometry_layer: "parcels",
    },
  },
  parcel_tax_records_mdb: {
    fixtureId: "parcel_tax_records_mdb",
    kind: "file_backed",
    baseKey: "stl-parcel-tax-records-mdb",
    baseName: "St. Louis Parcel Tax Records MDB",
    sourceType: "tax_records",
    sourceMode: "remote_url",
    parserKind: "mdb",
    refreshCadenceSeconds: 7 * 24 * 60 * 60,
    locationUrl: `${STL_BASE}/tax/parcel_tax_records.mdb`,
    metadata: {
      city: "St. Louis",
      domain: "tax",
      format: "mdb",
      canonical_fixture: true,
    },
    configuration: {
      url: `${STL_BASE}/tax/parcel_tax_records.mdb`,
      parser_kind: "mdb",
      table: "TaxParcels",
    },
  },
  street_geocoder: {
    fixtureId: "street_geocoder",
    kind: "service_geocoder",
    baseKey: "stl-street-geocoder",
    baseName: "St. Louis Street Geocoder",
    sourceType: "geocoder",
    sourceMode: "manual",
    parserKind: "geocoder_api",
    refreshCadenceSeconds: 24 * 60 * 60,
    locationUrl: "https://gis.stlouis-mo.gov/arcgis/rest/services/Geocode/Street/GeocodeServer",
    metadata: {
      city: "St. Louis",
      domain: "geocoder",
      mode: "street",
      canonical_fixture: true,
    },
    configuration: {
      endpoint: "https://gis.stlouis-mo.gov/arcgis/rest/services/Geocode/Street/GeocodeServer",
      parser_kind: "geocoder_api",
      output_srid: 26915,
    },
  },
  parcel_geocoder: {
    fixtureId: "parcel_geocoder",
    kind: "service_geocoder",
    baseKey: "stl-parcel-geocoder",
    baseName: "St. Louis Parcel Geocoder",
    sourceType: "geocoder",
    sourceMode: "manual",
    parserKind: "geocoder_api",
    refreshCadenceSeconds: 24 * 60 * 60,
    locationUrl: "https://gis.stlouis-mo.gov/arcgis/rest/services/Geocode/Parcel/GeocodeServer",
    metadata: {
      city: "St. Louis",
      domain: "geocoder",
      mode: "parcel",
      canonical_fixture: true,
    },
    configuration: {
      endpoint: "https://gis.stlouis-mo.gov/arcgis/rest/services/Geocode/Parcel/GeocodeServer",
      parser_kind: "geocoder_api",
      output_srid: 26915,
    },
  },
  csb_service_requests: {
    fixtureId: "csb_service_requests",
    kind: "service_geocoder",
    baseKey: "stl-csb-service-requests",
    baseName: "St. Louis CSB Service Requests",
    sourceType: "service_requests",
    sourceMode: "remote_url",
    parserKind: "csv_http",
    refreshCadenceSeconds: 12 * 60 * 60,
    locationUrl: `${STL_BASE}/services/csb_requests.csv`,
    metadata: {
      city: "St. Louis",
      domain: "service_requests",
      canonical_fixture: true,
    },
    configuration: {
      url: `${STL_BASE}/services/csb_requests.csv`,
      parser_kind: "csv_http",
      id_field: "request_id",
    },
  },
  inspections_mdb: {
    fixtureId: "inspections_mdb",
    kind: "file_backed",
    baseKey: "stl-inspections-mdb",
    baseName: "St. Louis Inspections MDB",
    sourceType: "inspections",
    sourceMode: "remote_url",
    parserKind: "mdb",
    refreshCadenceSeconds: 7 * 24 * 60 * 60,
    locationUrl: `${STL_BASE}/inspections/inspections.mdb`,
    metadata: {
      city: "St. Louis",
      domain: "inspections",
      canonical_fixture: true,
    },
    configuration: {
      url: `${STL_BASE}/inspections/inspections.mdb`,
      parser_kind: "mdb",
      table: "Inspections",
    },
  },
  housing_conservation_inspections_mdb: {
    fixtureId: "housing_conservation_inspections_mdb",
    kind: "file_backed",
    baseKey: "stl-housing-conservation-inspections-mdb",
    baseName: "St. Louis Housing Conservation Inspections MDB",
    sourceType: "housing_conservation",
    sourceMode: "remote_url",
    parserKind: "mdb",
    refreshCadenceSeconds: 7 * 24 * 60 * 60,
    locationUrl: `${STL_BASE}/inspections/housing_conservation_inspections.mdb`,
    metadata: {
      city: "St. Louis",
      domain: "housing_conservation",
      canonical_fixture: true,
    },
    configuration: {
      url: `${STL_BASE}/inspections/housing_conservation_inspections.mdb`,
      parser_kind: "mdb",
      table: "HousingConservationInspections",
    },
  },
  building_permits_mdb: {
    fixtureId: "building_permits_mdb",
    kind: "file_backed",
    baseKey: "stl-building-permits-mdb",
    baseName: "St. Louis Building Permits MDB",
    sourceType: "building_permits",
    sourceMode: "remote_url",
    parserKind: "mdb",
    refreshCadenceSeconds: 7 * 24 * 60 * 60,
    locationUrl: `${STL_BASE}/permits/building_permits.mdb`,
    metadata: {
      city: "St. Louis",
      domain: "permits",
      canonical_fixture: true,
    },
    configuration: {
      url: `${STL_BASE}/permits/building_permits.mdb`,
      parser_kind: "mdb",
      table: "BuildingPermits",
    },
  },
};

export function stLouisFixture(fixtureId: string): StLouisSourceFixture {
  const fixture = ST_LOUIS_SOURCE_FIXTURES[fixtureId];
  if (!fixture) {
    throw new Error(`Unknown St. Louis source fixture '${fixtureId}'`);
  }
  return fixture;
}
