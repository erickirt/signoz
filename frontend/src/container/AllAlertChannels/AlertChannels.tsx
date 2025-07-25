/* eslint-disable react/display-name */
import { Button } from 'antd';
import { ColumnsType } from 'antd/lib/table';
import { ResizeTable } from 'components/ResizeTable';
import ROUTES from 'constants/routes';
import useComponentPermission from 'hooks/useComponentPermission';
import { useNotifications } from 'hooks/useNotifications';
import history from 'lib/history';
import { useAppContext } from 'providers/App/App';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath } from 'react-router-dom';
import { Channels } from 'types/api/channels/getAll';

import Delete from './Delete';

function AlertChannels({ allChannels }: AlertChannelsProps): JSX.Element {
	const { t } = useTranslation(['channels']);
	const { notifications } = useNotifications();
	const { user } = useAppContext();
	const [action] = useComponentPermission(['new_alert_action'], user.role);

	const onClickEditHandler = useCallback((id: string) => {
		history.push(
			generatePath(ROUTES.CHANNELS_EDIT, {
				channelId: id,
			}),
		);
	}, []);

	const columns: ColumnsType<Channels> = [
		{
			title: t('column_channel_name'),
			dataIndex: 'name',
			key: 'name',
			width: 100,
		},
		{
			title: t('column_channel_type'),
			dataIndex: 'type',
			key: 'type',
			width: 80,
		},
	];

	if (action) {
		columns.push({
			title: t('column_channel_action'),
			dataIndex: 'id',
			key: 'action',
			align: 'center',
			width: 80,
			render: (id: string): JSX.Element => (
				<>
					<Button onClick={(): void => onClickEditHandler(id)} type="link">
						{t('column_channel_edit')}
					</Button>
					<Delete id={id} notifications={notifications} />
				</>
			),
		});
	}

	return (
		<ResizeTable
			columns={columns}
			dataSource={allChannels}
			rowKey="id"
			bordered
		/>
	);
}

interface AlertChannelsProps {
	allChannels: Channels[];
}

export default AlertChannels;
