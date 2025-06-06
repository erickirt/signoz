/* eslint-disable react-hooks/exhaustive-deps */
import { DefaultOptionType } from 'antd/es/select';
import { getAttributesValues } from 'api/queryBuilder/getAttributesValues';
import { useQuery } from 'react-query';
import { DataTypes } from 'types/api/queryBuilder/queryAutocompleteResponse';
import { DataSource } from 'types/common/queryBuilder';

export interface ConfigOptions {
	attributeKey: string;
	searchText?: string;
}

export interface GetAllConfigOptionsResponse {
	options: DefaultOptionType[];
	isFetching: boolean;
}

export function useGetAllConfigOptions(
	props: ConfigOptions,
	dotMetricsEnabled: boolean,
): GetAllConfigOptionsResponse {
	const { attributeKey, searchText } = props;

	const { data, isLoading } = useQuery(
		['attributesValues', attributeKey, searchText],
		async (): Promise<DefaultOptionType[]> => {
			const { payload } = await getAttributesValues({
				aggregateOperator: 'avg',
				dataSource: DataSource.METRICS,
				aggregateAttribute: dotMetricsEnabled
					? 'kafka.consumer_group.lag'
					: 'kafka_consumer_group_lag',
				attributeKey,
				searchText: searchText ?? '',
				filterAttributeKeyDataType: DataTypes.String,
				tagType: 'tag',
			});

			if (payload) {
				const values = payload.stringAttributeValues || [];
				const options: DefaultOptionType[] = values.map((val: string) => ({
					label: val,
					value: val,
				}));
				return options;
			}
			return [];
		},
	);

	return { options: data ?? [], isFetching: isLoading };
}
