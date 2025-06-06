/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import './SideNav.styles.scss';

import { Color } from '@signozhq/design-tokens';
import { Button, Tooltip } from 'antd';
import logEvent from 'api/common/logEvent';
import cx from 'classnames';
import { FeatureKeys } from 'constants/features';
import ROUTES from 'constants/routes';
import { GlobalShortcuts } from 'constants/shortcuts/globalShortcuts';
import { useKeyboardHotkeys } from 'hooks/hotkeys/useKeyboardHotkeys';
import useComponentPermission from 'hooks/useComponentPermission';
import { useGetTenantLicense } from 'hooks/useGetTenantLicense';
import { StatusCodes } from 'http-status-codes';
import history from 'lib/history';
import {
	AlertTriangle,
	CheckSquare,
	PackagePlus,
	UserCircle,
} from 'lucide-react';
import { useAppContext } from 'providers/App/App';
import { MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { AppState } from 'store/reducers';
import { LicenseStatus } from 'types/api/licensesV3/getActive';
import AppReducer from 'types/reducer/app';
import { USER_ROLES } from 'types/roles';
import { checkVersionState } from 'utils/app';

import { routeConfig } from './config';
import { getQueryString } from './helper';
import defaultMenuItems, {
	helpSupportMenuItem,
	inviteMemberMenuItem,
	manageLicenseMenuItem,
	shortcutMenuItem,
	slackSupportMenuItem,
	trySignozCloudMenuItem,
} from './menuItems';
import NavItem from './NavItem/NavItem';
import { SecondaryMenuItemKey, SidebarItem } from './sideNav.types';
import { getActiveMenuKeyFromPath } from './sideNav.utils';

interface UserManagementMenuItems {
	key: string;
	label: string;
	icon: JSX.Element;
}

function SideNav(): JSX.Element {
	const [menuItems, setMenuItems] = useState(defaultMenuItems);
	const { pathname, search } = useLocation();
	const { currentVersion, latestVersion, isCurrentVersionError } = useSelector<
		AppState,
		AppReducer
	>((state) => state.app);

	const {
		user,
		featureFlags,
		trialInfo,
		activeLicense,
		activeLicenseFetchError,
	} = useAppContext();

	const isOnboardingV3Enabled = featureFlags?.find(
		(flag) => flag.name === FeatureKeys.ONBOARDING_V3,
	)?.active;

	const [licenseTag, setLicenseTag] = useState('');

	const userSettingsMenuItem = {
		key: ROUTES.MY_SETTINGS,
		label: user?.displayName || 'User',
		icon: <UserCircle size={16} />,
	};

	const [userManagementMenuItems, setUserManagementMenuItems] = useState<
		UserManagementMenuItems[]
	>([]);

	const onClickSlackHandler = (): void => {
		window.open('https://signoz.io/slack', '_blank');
	};

	const isLatestVersion = checkVersionState(currentVersion, latestVersion);

	const [inviteMembers] = useComponentPermission(['invite_members'], user.role);

	const { registerShortcut, deregisterShortcut } = useKeyboardHotkeys();

	const {
		isCloudUser,
		isEnterpriseSelfHostedUser,
		isCommunityUser,
		isCommunityEnterpriseUser,
	} = useGetTenantLicense();

	const { t } = useTranslation('');

	const licenseStatus: string = activeLicense?.status || '';

	const isWorkspaceBlocked = trialInfo?.workSpaceBlock || false;

	const isLicenseActive = licenseStatus !== '' && licenseStatus !== 'INVALID';

	const onClickSignozCloud = (): void => {
		window.open(
			'https://signoz.io/oss-to-cloud/?utm_source=product_navbar&utm_medium=frontend&utm_campaign=oss_users',
			'_blank',
		);
	};

	const isCtrlMetaKey = (e: MouseEvent): boolean => e.ctrlKey || e.metaKey;

	const openInNewTab = (path: string): void => {
		window.open(path, '_blank');
	};

	const onClickShortcuts = (e: MouseEvent): void => {
		// eslint-disable-next-line sonarjs/no-duplicate-string
		logEvent('Sidebar: Menu clicked', {
			menuRoute: '/shortcuts',
			menuLabel: 'Keyboard Shortcuts',
		});
		if (isCtrlMetaKey(e)) {
			openInNewTab('/shortcuts');
		} else {
			history.push(`/shortcuts`);
		}
	};

	const onClickGetStarted = (event: MouseEvent): void => {
		logEvent('Sidebar: Menu clicked', {
			menuRoute: '/get-started',
			menuLabel: 'Get Started',
		});

		const onboaringRoute = isOnboardingV3Enabled
			? ROUTES.GET_STARTED_WITH_CLOUD
			: ROUTES.GET_STARTED;

		if (isCtrlMetaKey(event)) {
			openInNewTab(onboaringRoute);
		} else {
			history.push(onboaringRoute);
		}
	};

	const onClickVersionHandler = useCallback((event: MouseEvent): void => {
		if (isCtrlMetaKey(event)) {
			openInNewTab(ROUTES.VERSION);
		} else {
			history.push(ROUTES.VERSION);
		}
	}, []);

	const onClickHandler = useCallback(
		(key: string, event: MouseEvent | null) => {
			const params = new URLSearchParams(search);
			const availableParams = routeConfig[key];

			const queryString = getQueryString(availableParams || [], params);

			if (pathname !== key) {
				if (event && isCtrlMetaKey(event)) {
					openInNewTab(`${key}?${queryString.join('&')}`);
				} else {
					history.push(`${key}?${queryString.join('&')}`, {
						from: pathname,
					});
				}
			}
		},
		[pathname, search],
	);

	const activeMenuKey = useMemo(() => getActiveMenuKeyFromPath(pathname), [
		pathname,
	]);

	const handleUserManagentMenuItemClick = (
		key: string,
		event: MouseEvent,
	): void => {
		switch (key) {
			case SecondaryMenuItemKey.Slack:
				onClickSlackHandler();
				break;
			case SecondaryMenuItemKey.Version:
				onClickVersionHandler(event);
				break;
			default:
				onClickHandler(key, event);
				break;
		}
	};

	useEffect(() => {
		if (isCloudUser) {
			setLicenseTag('Cloud');
		} else if (isEnterpriseSelfHostedUser) {
			setLicenseTag('Enterprise');
		} else if (isCommunityEnterpriseUser) {
			setLicenseTag('Enterprise');
		} else if (isCommunityUser) {
			setLicenseTag('Community');
		}
	}, [
		isCloudUser,
		isEnterpriseSelfHostedUser,
		isCommunityEnterpriseUser,
		isCommunityUser,
	]);

	const [isCurrentOrgSettings] = useComponentPermission(
		['current_org_settings'],
		user.role,
	);

	const settingsRoute = isCurrentOrgSettings
		? ROUTES.ORG_SETTINGS
		: ROUTES.SETTINGS;

	const handleMenuItemClick = (event: MouseEvent, item: SidebarItem): void => {
		if (item.key === ROUTES.SETTINGS) {
			if (isCtrlMetaKey(event)) {
				openInNewTab(settingsRoute);
			} else {
				history.push(settingsRoute);
			}
		} else if (item) {
			onClickHandler(item?.key as string, event);
		}
		logEvent('Sidebar: Menu clicked', {
			menuRoute: item?.key,
			menuLabel: item?.label,
		});
	};

	useEffect(() => {
		registerShortcut(GlobalShortcuts.NavigateToServices, () =>
			onClickHandler(ROUTES.APPLICATION, null),
		);
		registerShortcut(GlobalShortcuts.NavigateToTraces, () =>
			onClickHandler(ROUTES.TRACE, null),
		);

		registerShortcut(GlobalShortcuts.NavigateToLogs, () =>
			onClickHandler(ROUTES.LOGS, null),
		);

		registerShortcut(GlobalShortcuts.NavigateToDashboards, () =>
			onClickHandler(ROUTES.ALL_DASHBOARD, null),
		);

		registerShortcut(GlobalShortcuts.NavigateToMessagingQueues, () =>
			onClickHandler(ROUTES.MESSAGING_QUEUES_OVERVIEW, null),
		);

		registerShortcut(GlobalShortcuts.NavigateToAlerts, () =>
			onClickHandler(ROUTES.LIST_ALL_ALERT, null),
		);
		registerShortcut(GlobalShortcuts.NavigateToExceptions, () =>
			onClickHandler(ROUTES.ALL_ERROR, null),
		);

		return (): void => {
			deregisterShortcut(GlobalShortcuts.NavigateToServices);
			deregisterShortcut(GlobalShortcuts.NavigateToTraces);
			deregisterShortcut(GlobalShortcuts.NavigateToLogs);
			deregisterShortcut(GlobalShortcuts.NavigateToDashboards);
			deregisterShortcut(GlobalShortcuts.NavigateToAlerts);
			deregisterShortcut(GlobalShortcuts.NavigateToExceptions);
			deregisterShortcut(GlobalShortcuts.NavigateToMessagingQueues);
		};
	}, [deregisterShortcut, onClickHandler, registerShortcut]);

	// eslint-disable-next-line sonarjs/cognitive-complexity
	useEffect(() => {
		let updatedMenuItems = defaultMenuItems;
		let updatedUserManagementItems: UserManagementMenuItems[] = [
			manageLicenseMenuItem,
		];

		if (isCloudUser || isEnterpriseSelfHostedUser) {
			const isOnboardingEnabled =
				featureFlags?.find((feature) => feature.name === FeatureKeys.ONBOARDING)
					?.active || false;

			if (!isOnboardingEnabled) {
				updatedMenuItems = updatedMenuItems.filter(
					(item) =>
						item.key !== ROUTES.GET_STARTED &&
						item.key !== ROUTES.ONBOARDING &&
						item.key !== ROUTES.GET_STARTED_WITH_CLOUD,
				);
			}

			const isOnBasicPlan =
				(activeLicenseFetchError &&
					[StatusCodes.NOT_FOUND, StatusCodes.NOT_IMPLEMENTED].includes(
						activeLicenseFetchError?.getHttpStatusCode(),
					)) ||
				(activeLicense?.status && activeLicense.status === LicenseStatus.INVALID);

			if (user.role !== USER_ROLES.ADMIN || isOnBasicPlan) {
				updatedMenuItems = updatedMenuItems.filter(
					(item) => item.key !== ROUTES.BILLING,
				);
			}

			updatedUserManagementItems = [helpSupportMenuItem];

			// Show manage license menu item for EE cloud users with a active license
			if (isEnterpriseSelfHostedUser) {
				updatedUserManagementItems.push(manageLicenseMenuItem);
			}
		} else {
			updatedMenuItems = updatedMenuItems.filter(
				(item) => item.key !== ROUTES.INTEGRATIONS && item.key !== ROUTES.BILLING,
			);
			const versionMenuItem = {
				key: SecondaryMenuItemKey.Version,
				label: !isCurrentVersionError ? currentVersion : t('n_a'),
				icon: !isLatestVersion ? (
					<AlertTriangle color={Color.BG_CHERRY_600} size={16} />
				) : (
					<CheckSquare color={Color.BG_FOREST_500} size={16} />
				),
				onClick: onClickVersionHandler,
			};

			updatedUserManagementItems = [versionMenuItem, slackSupportMenuItem];

			if (isCommunityEnterpriseUser) {
				updatedUserManagementItems.push(manageLicenseMenuItem);
			}
		}
		setMenuItems(updatedMenuItems);
		setUserManagementMenuItems(updatedUserManagementItems);
	}, [
		isCommunityEnterpriseUser,
		currentVersion,
		featureFlags,
		isCloudUser,
		isEnterpriseSelfHostedUser,
		isCurrentVersionError,
		isLatestVersion,
		onClickVersionHandler,
		t,
		user.role,
		activeLicenseFetchError,
		activeLicense?.status,
	]);

	return (
		<div className={cx('sidenav-container')}>
			<div className={cx('sideNav')}>
				<div className="brand">
					<div className="brand-company-meta">
						<div
							className="brand-logo"
							// eslint-disable-next-line react/no-unknown-property
							onClick={(event: MouseEvent): void => {
								// Current home page
								onClickHandler(ROUTES.HOME, event);
							}}
						>
							<img src="/Logos/signoz-brand-logo.svg" alt="SigNoz" />

							<span className="brand-logo-name nav-item-label"> SigNoz </span>
						</div>

						{licenseTag && (
							<Tooltip
								title={
									// eslint-disable-next-line no-nested-ternary
									isCommunityUser
										? 'You are running the community version of SigNoz. You have to install the Enterprise edition in order enable Enterprise features.'
										: isCommunityEnterpriseUser
										? 'You do not have an active license present. Add an active license to enable Enterprise features.'
										: ''
								}
								placement="bottomRight"
							>
								<div
									className={cx(
										'license tag nav-item-label',
										isCommunityEnterpriseUser && 'community-enterprise-user',
									)}
								>
									{licenseTag}
								</div>
							</Tooltip>
						)}
					</div>
				</div>

				{isCloudUser && user?.role !== USER_ROLES.VIEWER && (
					<div className="get-started-nav-items">
						<Button
							className="get-started-btn"
							disabled={isWorkspaceBlocked}
							onClick={(event: MouseEvent): void => {
								if (isWorkspaceBlocked) {
									return;
								}
								onClickGetStarted(event);
							}}
						>
							<PackagePlus size={16} />

							<div className="license tag nav-item-label"> New source </div>
						</Button>
					</div>
				)}

				<div className={cx(`nav-wrapper`, isCloudUser && 'nav-wrapper-cloud')}>
					<div className="primary-nav-items">
						{menuItems.map((item, index) => (
							<NavItem
								key={item.key || index}
								item={item}
								isActive={activeMenuKey === item.key}
								isDisabled={
									isWorkspaceBlocked &&
									item.key !== ROUTES.BILLING &&
									item.key !== ROUTES.SETTINGS
								}
								onClick={(event): void => {
									handleMenuItemClick(event, item);
								}}
							/>
						))}
					</div>

					<div className="secondary-nav-items">
						<NavItem
							key="keyboardShortcuts"
							item={shortcutMenuItem}
							isDisabled={isWorkspaceBlocked}
							isActive={false}
							onClick={onClickShortcuts}
						/>

						{!isLicenseActive && (
							<NavItem
								key="trySignozCloud"
								item={trySignozCloudMenuItem}
								isActive={false}
								isDisabled={isWorkspaceBlocked}
								onClick={onClickSignozCloud}
							/>
						)}

						{userManagementMenuItems.map(
							(item, index): JSX.Element => (
								<NavItem
									key={item?.key || index}
									item={item}
									isActive={activeMenuKey === item?.key}
									isDisabled={isWorkspaceBlocked}
									onClick={(event: MouseEvent): void => {
										handleUserManagentMenuItemClick(item?.key as string, event);
										logEvent('Sidebar: Menu clicked', {
											menuRoute: item?.key,
											menuLabel: item?.label,
										});
									}}
								/>
							),
						)}

						{inviteMembers && (
							<NavItem
								key={inviteMemberMenuItem.key}
								item={inviteMemberMenuItem}
								isActive={activeMenuKey === inviteMemberMenuItem?.key}
								isDisabled={false}
								onClick={(event: React.MouseEvent): void => {
									if (isCtrlMetaKey(event)) {
										openInNewTab(`${inviteMemberMenuItem.key}`);
									} else {
										history.push(`${inviteMemberMenuItem.key}`);
									}
									logEvent('Sidebar: Menu clicked', {
										menuRoute: inviteMemberMenuItem?.key,
										menuLabel: inviteMemberMenuItem?.label,
									});
								}}
							/>
						)}

						{user && (
							<NavItem
								key={ROUTES.MY_SETTINGS}
								item={userSettingsMenuItem}
								isActive={activeMenuKey === userSettingsMenuItem?.key}
								isDisabled={false}
								onClick={(event: MouseEvent): void => {
									handleUserManagentMenuItemClick(
										userSettingsMenuItem?.key as string,
										event,
									);
									logEvent('Sidebar: Menu clicked', {
										menuRoute: userSettingsMenuItem?.key,
										menuLabel: 'User',
									});
								}}
							/>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export default SideNav;
