/* eslint-disable sonarjs/no-duplicate-string */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExplorerViews } from 'pages/LogsExplorer/utils';
import MockQueryClientProvider from 'providers/test/MockQueryClientProvider';

import LeftToolbarActions from '../LeftToolbarActions';
import RightToolbarActions from '../RightToolbarActions';

describe('ToolbarActions', () => {
	const mockHandleFilterVisibilityChange = (): void => {};

	const defaultItems = {
		list: {
			name: 'list',
			label: 'List View',
			disabled: false,
			show: true,
			key: ExplorerViews.LIST,
		},
		timeseries: {
			name: 'timeseries',
			label: 'Time Series',
			disabled: false,
			show: true,
			key: ExplorerViews.TIMESERIES,
		},
		clickhouse: {
			name: 'clickhouse',
			label: 'Clickhouse',
			disabled: false,
			show: false,
			key: 'clickhouse',
		},
	};

	it('LeftToolbarActions - renders correctly with default props', async () => {
		const handleChangeSelectedView = jest.fn();
		const { queryByTestId } = render(
			<LeftToolbarActions
				items={defaultItems}
				selectedView={ExplorerViews.LIST}
				onChangeSelectedView={handleChangeSelectedView}
				showFilter
				handleFilterVisibilityChange={mockHandleFilterVisibilityChange}
			/>,
		);
		expect(screen.getByTestId('search-view')).toBeInTheDocument();
		expect(screen.getByTestId('query-builder-view')).toBeInTheDocument();

		// clickhouse should not be present as its show: false
		expect(queryByTestId('clickhouse-view')).not.toBeInTheDocument();

		await userEvent.click(screen.getByTestId('search-view'));
		expect(handleChangeSelectedView).toBeCalled();

		await userEvent.click(screen.getByTestId('query-builder-view'));
		expect(handleChangeSelectedView).toBeCalled();
	});

	it('renders - clickhouse view and test view switching', async () => {
		const handleChangeSelectedView = jest.fn();
		const clickhouseItems = {
			...defaultItems,
			list: { ...defaultItems.list, show: false },
			clickhouse: { ...defaultItems.clickhouse, show: true },
		};
		const { queryByTestId } = render(
			<LeftToolbarActions
				items={clickhouseItems}
				selectedView={ExplorerViews.TIMESERIES}
				onChangeSelectedView={handleChangeSelectedView}
				showFilter
				handleFilterVisibilityChange={mockHandleFilterVisibilityChange}
			/>,
		);

		const clickHouseView = queryByTestId('clickhouse-view');
		expect(clickHouseView).toBeInTheDocument();

		await userEvent.click(clickHouseView as HTMLElement);
		expect(handleChangeSelectedView).toBeCalled();

		// Test that timeseries view is also present and clickable
		const timeseriesView = queryByTestId('query-builder-view');
		expect(timeseriesView).toBeInTheDocument();

		await userEvent.click(timeseriesView as HTMLElement);
		expect(handleChangeSelectedView).toBeCalled();
	});

	it('RightToolbarActions - render correctly with props', async () => {
		const onStageRunQuery = jest.fn();
		const { queryByText } = render(
			<MockQueryClientProvider>
				<RightToolbarActions onStageRunQuery={onStageRunQuery} />,
			</MockQueryClientProvider>,
		);

		const stageNRunBtn = queryByText('Stage & Run Query');
		expect(stageNRunBtn).toBeInTheDocument();
		await userEvent.click(stageNRunBtn as HTMLElement);
		expect(onStageRunQuery).toBeCalled();
	});
});
