import { Col } from 'antd';
import logEvent from 'api/common/logEvent';
import { ENTITY_VERSION_V4 } from 'constants/app';
import { QueryParams } from 'constants/query';
import { PANEL_TYPES } from 'constants/queryBuilder';
import Graph from 'container/GridCardLayout/GridCard';
import {
	externalCallDuration,
	externalCallDurationByAddress,
	externalCallErrorPercent,
	externalCallRpsByAddress,
} from 'container/MetricsApplication/MetricsPageQueries/ExternalQueries';
import useResourceAttribute from 'hooks/useResourceAttribute';
import {
	convertRawQueriesToTraceSelectedTags,
	getResourceDeploymentKeys,
	resourceAttributesToTagFilterItems,
} from 'hooks/useResourceAttribute/utils';
import { useSafeNavigate } from 'hooks/useSafeNavigate';
import useUrlQuery from 'hooks/useUrlQuery';
import getStep from 'lib/getStep';
import history from 'lib/history';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useLocation, useParams } from 'react-router-dom';
import store from 'store';
import { UpdateTimeInterval } from 'store/actions';
import { DataTypes } from 'types/api/queryBuilder/queryAutocompleteResponse';
import { EQueryType } from 'types/common/dashboard';
import { v4 as uuid } from 'uuid';

import { FeatureKeys } from '../../../constants/features';
import { useAppContext } from '../../../providers/App/App';
import { GraphTitle, legend, MENU_ITEMS } from '../constant';
import { getWidgetQueryBuilder } from '../MetricsApplication.factory';
import { Card, GraphContainer, Row } from '../styles';
import GraphControlsPanel from './Overview/GraphControlsPanel/GraphControlsPanel';
import { IServiceName } from './types';
import {
	handleNonInQueryRange,
	onViewAPIMonitoringPopupClick,
	onViewTracePopupClick,
	useGetAPMToTracesQueries,
	useGraphClickHandler,
} from './util';

function External(): JSX.Element {
	const [selectedTimeStamp, setSelectedTimeStamp] = useState<number>(0);
	const [selectedData, setSelectedData] = useState<any>(undefined);
	const { servicename: encodedServiceName } = useParams<IServiceName>();

	const servicename = decodeURIComponent(encodedServiceName);
	const { queries } = useResourceAttribute();

	const urlQuery = useUrlQuery();
	const { pathname } = useLocation();
	const dispatch = useDispatch();

	const onDragSelect = useCallback(
		(start: number, end: number) => {
			const startTimestamp = Math.trunc(start);
			const endTimestamp = Math.trunc(end);

			urlQuery.set(QueryParams.startTime, startTimestamp.toString());
			urlQuery.set(QueryParams.endTime, endTimestamp.toString());
			const generatedUrl = `${pathname}?${urlQuery.toString()}`;
			history.push(generatedUrl);

			if (startTimestamp !== endTimestamp) {
				dispatch(UpdateTimeInterval('custom', [startTimestamp, endTimestamp]));
			}
		},
		[dispatch, pathname, urlQuery],
	);

	const tagFilterItems = useMemo(
		() =>
			handleNonInQueryRange(resourceAttributesToTagFilterItems(queries)) || [],
		[queries],
	);
	const { featureFlags } = useAppContext();
	const dotMetricsEnabled =
		featureFlags?.find((flag) => flag.name === FeatureKeys.DOT_METRICS_ENABLED)
			?.active || false;

	const externalCallErrorWidget = useMemo(
		() =>
			getWidgetQueryBuilder({
				query: {
					queryType: EQueryType.QUERY_BUILDER,
					promql: [],
					builder: externalCallErrorPercent({
						servicename,
						legend: legend.address,
						tagFilterItems,
						dotMetricsEnabled,
					}),
					clickhouse_sql: [],
					id: uuid(),
				},
				title: GraphTitle.EXTERNAL_CALL_ERROR_PERCENTAGE,
				panelTypes: PANEL_TYPES.TIME_SERIES,
				yAxisUnit: '%',
				id: GraphTitle.EXTERNAL_CALL_ERROR_PERCENTAGE,
			}),
		[servicename, tagFilterItems, dotMetricsEnabled],
	);

	const selectedTraceTags = useMemo(
		() => JSON.stringify(convertRawQueriesToTraceSelectedTags(queries) || []),
		[queries],
	);

	const externalCallDurationWidget = useMemo(
		() =>
			getWidgetQueryBuilder({
				query: {
					queryType: EQueryType.QUERY_BUILDER,
					promql: [],
					builder: externalCallDuration({
						servicename,
						tagFilterItems,
						dotMetricsEnabled,
					}),
					clickhouse_sql: [],
					id: uuid(),
				},
				title: GraphTitle.EXTERNAL_CALL_DURATION,
				panelTypes: PANEL_TYPES.TIME_SERIES,
				yAxisUnit: 'ms',
				id: GraphTitle.EXTERNAL_CALL_DURATION,
				fillSpans: true,
			}),
		[servicename, tagFilterItems, dotMetricsEnabled],
	);

	const errorApmToTraceQuery = useGetAPMToTracesQueries({
		servicename,
		isExternalCall: true,
		filters: [
			{
				id: uuid().slice(0, 8),
				key: {
					key: 'hasError',
					dataType: DataTypes.bool,
					type: 'tag',
					isColumn: true,
					isJSON: false,
					id: 'hasError--bool--tag--true',
				},
				op: 'in',
				value: ['true'],
			},
		],
	});

	const stepInterval = useMemo(
		() =>
			getStep({
				end: store.getState().globalTime.maxTime,
				inputFormat: 'ns',
				start: store.getState().globalTime.minTime,
			}),
		[],
	);
	const logEventCalledRef = useRef(false);
	useEffect(() => {
		if (!logEventCalledRef.current) {
			const selectedEnvironments = queries.find(
				(val) => val.tagKey === getResourceDeploymentKeys(dotMetricsEnabled),
			)?.tagValue;

			logEvent('APM: Service detail page visited', {
				selectedEnvironments,
				resourceAttributeUsed: !!queries?.length,
				section: 'externalMetrics',
			});
			logEventCalledRef.current = true;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const externalCallRPSWidget = useMemo(
		() =>
			getWidgetQueryBuilder({
				query: {
					queryType: EQueryType.QUERY_BUILDER,
					promql: [],
					builder: externalCallRpsByAddress({
						servicename,
						legend: legend.address,
						tagFilterItems,
						dotMetricsEnabled,
					}),
					clickhouse_sql: [],
					id: uuid(),
				},
				title: GraphTitle.EXTERNAL_CALL_RPS_BY_ADDRESS,
				panelTypes: PANEL_TYPES.TIME_SERIES,
				yAxisUnit: 'reqps',
				id: GraphTitle.EXTERNAL_CALL_RPS_BY_ADDRESS,
				fillSpans: true,
			}),
		[servicename, tagFilterItems, dotMetricsEnabled],
	);

	const externalCallDurationAddressWidget = useMemo(
		() =>
			getWidgetQueryBuilder({
				query: {
					queryType: EQueryType.QUERY_BUILDER,
					promql: [],
					builder: externalCallDurationByAddress({
						servicename,
						legend: legend.address,
						tagFilterItems,
						dotMetricsEnabled,
					}),
					clickhouse_sql: [],
					id: uuid(),
				},
				title: GraphTitle.EXTERNAL_CALL_DURATION_BY_ADDRESS,
				panelTypes: PANEL_TYPES.TIME_SERIES,
				yAxisUnit: 'ms',
				id: GraphTitle.EXTERNAL_CALL_DURATION_BY_ADDRESS,
				fillSpans: true,
			}),
		[servicename, tagFilterItems, dotMetricsEnabled],
	);

	const apmToTraceQuery = useGetAPMToTracesQueries({
		servicename,
		isExternalCall: true,
	});

	const { safeNavigate } = useSafeNavigate();

	const onGraphClickHandler = useGraphClickHandler(
		setSelectedTimeStamp,
		setSelectedData,
	);

	return (
		<>
			<Row gutter={24}>
				<Col span={12}>
					<GraphControlsPanel
						id="external_call_error_percentage_button"
						onViewTracesClick={onViewTracePopupClick({
							servicename,
							selectedTraceTags,
							timestamp: selectedTimeStamp,
							apmToTraceQuery: errorApmToTraceQuery,
							stepInterval,
							safeNavigate,
						})}
						onViewAPIMonitoringClick={onViewAPIMonitoringPopupClick({
							servicename,
							timestamp: selectedTimeStamp,
							domainName: selectedData?.address || '',
							isError: true,
							stepInterval: 300,
							safeNavigate,
						})}
					/>
					<Card data-testid="external_call_error_percentage">
						<GraphContainer>
							<Graph
								headerMenuList={MENU_ITEMS}
								widget={externalCallErrorWidget}
								onClickHandler={(xValue, yValue, mouseX, mouseY, data): void => {
									onGraphClickHandler(
										xValue,
										yValue,
										mouseX,
										mouseY,
										'external_call_error_percentage',
										data,
									);
								}}
								onDragSelect={onDragSelect}
								version={ENTITY_VERSION_V4}
							/>
						</GraphContainer>
					</Card>
				</Col>

				<Col span={12}>
					<GraphControlsPanel
						id="external_call_duration_button"
						onViewTracesClick={onViewTracePopupClick({
							servicename,
							selectedTraceTags,
							timestamp: selectedTimeStamp,
							apmToTraceQuery,
							stepInterval,
							safeNavigate,
						})}
						onViewAPIMonitoringClick={onViewAPIMonitoringPopupClick({
							servicename,
							timestamp: selectedTimeStamp,
							domainName: selectedData?.address,
							isError: false,
							stepInterval: 300,
							safeNavigate,
						})}
					/>

					<Card data-testid="external_call_duration">
						<GraphContainer>
							<Graph
								headerMenuList={MENU_ITEMS}
								widget={externalCallDurationWidget}
								onClickHandler={(xValue, yValue, mouseX, mouseY, data): void => {
									onGraphClickHandler(
										xValue,
										yValue,
										mouseX,
										mouseY,
										'external_call_duration',
										data,
									);
								}}
								onDragSelect={onDragSelect}
								version={ENTITY_VERSION_V4}
							/>
						</GraphContainer>
					</Card>
				</Col>
			</Row>

			<Row gutter={24}>
				<Col span={12}>
					<GraphControlsPanel
						id="external_call_rps_by_address_button"
						onViewTracesClick={onViewTracePopupClick({
							servicename,
							selectedTraceTags,
							timestamp: selectedTimeStamp,
							apmToTraceQuery,
							stepInterval,
							safeNavigate,
						})}
						onViewAPIMonitoringClick={onViewAPIMonitoringPopupClick({
							servicename,
							timestamp: selectedTimeStamp,
							domainName: selectedData?.address,
							isError: false,
							stepInterval: 300,
							safeNavigate,
						})}
					/>
					<Card data-testid="external_call_rps_by_address">
						<GraphContainer>
							<Graph
								widget={externalCallRPSWidget}
								headerMenuList={MENU_ITEMS}
								onClickHandler={(xValue, yValue, mouseX, mouseY, data): Promise<void> =>
									onGraphClickHandler(
										xValue,
										yValue,
										mouseX,
										mouseY,
										'external_call_rps_by_address',
										data,
									)
								}
								onDragSelect={onDragSelect}
								version={ENTITY_VERSION_V4}
							/>
						</GraphContainer>
					</Card>
				</Col>

				<Col span={12}>
					<GraphControlsPanel
						id="external_call_duration_by_address_button"
						onViewTracesClick={onViewTracePopupClick({
							servicename,
							selectedTraceTags,
							timestamp: selectedTimeStamp,
							apmToTraceQuery,
							stepInterval,
							safeNavigate,
						})}
						onViewAPIMonitoringClick={onViewAPIMonitoringPopupClick({
							servicename,
							timestamp: selectedTimeStamp,
							domainName: selectedData?.address,
							isError: false,
							stepInterval: 300,
							safeNavigate,
						})}
					/>

					<Card data-testid="external_call_duration_by_address">
						<GraphContainer>
							<Graph
								widget={externalCallDurationAddressWidget}
								headerMenuList={MENU_ITEMS}
								onClickHandler={(xValue, yValue, mouseX, mouseY, data): void => {
									onGraphClickHandler(
										xValue,
										yValue,
										mouseX,
										mouseY,
										'external_call_duration_by_address',
										data,
									);
								}}
								onDragSelect={onDragSelect}
								version={ENTITY_VERSION_V4}
							/>
						</GraphContainer>
					</Card>
				</Col>
			</Row>
		</>
	);
}

export default External;
