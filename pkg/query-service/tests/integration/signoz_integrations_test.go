package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/SigNoz/signoz/pkg/alertmanager"
	"github.com/SigNoz/signoz/pkg/alertmanager/alertmanagerserver"
	"github.com/SigNoz/signoz/pkg/alertmanager/signozalertmanager"
	"github.com/SigNoz/signoz/pkg/analytics/analyticstest"
	"github.com/SigNoz/signoz/pkg/emailing/emailingtest"
	"github.com/SigNoz/signoz/pkg/http/middleware"
	"github.com/SigNoz/signoz/pkg/instrumentation/instrumentationtest"
	"github.com/SigNoz/signoz/pkg/modules/organization/implorganization"
	"github.com/SigNoz/signoz/pkg/modules/user"
	"github.com/SigNoz/signoz/pkg/query-service/app"
	"github.com/SigNoz/signoz/pkg/query-service/app/cloudintegrations"
	"github.com/SigNoz/signoz/pkg/query-service/app/integrations"
	"github.com/SigNoz/signoz/pkg/query-service/model"
	v3 "github.com/SigNoz/signoz/pkg/query-service/model/v3"
	"github.com/SigNoz/signoz/pkg/query-service/utils"
	"github.com/SigNoz/signoz/pkg/sharder"
	"github.com/SigNoz/signoz/pkg/sharder/noopsharder"
	"github.com/SigNoz/signoz/pkg/signoz"
	"github.com/SigNoz/signoz/pkg/sqlstore"
	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/types/authtypes"
	"github.com/SigNoz/signoz/pkg/types/dashboardtypes"
	"github.com/SigNoz/signoz/pkg/types/pipelinetypes"
	"github.com/SigNoz/signoz/pkg/valuer"
	mockhouse "github.com/srikanthccv/ClickHouse-go-mock"
	"github.com/stretchr/testify/require"
)

// Higher level tests for UI facing APIs

func TestSignozIntegrationLifeCycle(t *testing.T) {
	require := require.New(t)
	testbed := NewIntegrationsTestBed(t, nil)

	merr := utils.CreateTestOrg(t, testbed.store)
	require.NoError(merr)

	installedResp := testbed.GetInstalledIntegrationsFromQS()
	require.Equal(
		len(installedResp.Integrations), 0,
		"no integrations should be installed at the beginning",
	)

	availableResp := testbed.GetAvailableIntegrationsFromQS()
	availableIntegrations := availableResp.Integrations
	require.Greater(
		len(availableIntegrations), 0,
		"some integrations should come bundled with SigNoz",
	)

	// Should be able to install integration
	require.False(availableIntegrations[0].IsInstalled)
	testbed.RequestQSToInstallIntegration(
		availableIntegrations[0].Id, map[string]interface{}{},
	)

	ii := testbed.GetIntegrationDetailsFromQS(availableIntegrations[0].Id)
	require.Equal(ii.Id, availableIntegrations[0].Id)
	require.NotNil(ii.Installation)

	installedResp = testbed.GetInstalledIntegrationsFromQS()
	installedIntegrations := installedResp.Integrations
	require.Equal(len(installedIntegrations), 1)
	require.Equal(installedIntegrations[0].Id, availableIntegrations[0].Id)

	availableResp = testbed.GetAvailableIntegrationsFromQS()
	availableIntegrations = availableResp.Integrations
	require.Greater(len(availableIntegrations), 0)

	// Integration connection status should get updated after signal data has been received.
	testbed.mockLogQueryResponse([]model.SignozLog{})
	testbed.mockMetricStatusQueryResponse(nil)
	connectionStatus := testbed.GetIntegrationConnectionStatus(ii.Id)
	require.NotNil(connectionStatus)
	require.Nil(connectionStatus.Logs)
	require.Nil(connectionStatus.Metrics)

	testLog := makeTestSignozLog("test log body", map[string]interface{}{
		"source": "nginx",
	})
	testbed.mockLogQueryResponse([]model.SignozLog{testLog})

	testMetricName := ii.ConnectionTests.Metrics[0]
	testMetricLastReceivedTs := time.Now().UnixMilli()
	testbed.mockMetricStatusQueryResponse(&model.MetricStatus{
		MetricName:           testMetricName,
		LastReceivedTsMillis: testMetricLastReceivedTs,
	})

	connectionStatus = testbed.GetIntegrationConnectionStatus(ii.Id)
	require.NotNil(connectionStatus)
	require.NotNil(connectionStatus.Logs)
	require.Equal(connectionStatus.Logs.LastReceivedTsMillis, int64(testLog.Timestamp/1000000))
	require.NotNil(connectionStatus.Metrics)
	require.Equal(connectionStatus.Metrics.LastReceivedTsMillis, testMetricLastReceivedTs)

	// Should be able to uninstall integration
	require.True(availableIntegrations[0].IsInstalled)
	testbed.RequestQSToUninstallIntegration(
		availableIntegrations[0].Id,
	)

	ii = testbed.GetIntegrationDetailsFromQS(availableIntegrations[0].Id)
	require.Equal(ii.Id, availableIntegrations[0].Id)
	require.Nil(ii.Installation)

	installedResp = testbed.GetInstalledIntegrationsFromQS()
	installedIntegrations = installedResp.Integrations
	require.Equal(len(installedIntegrations), 0)

	availableResp = testbed.GetAvailableIntegrationsFromQS()
	availableIntegrations = availableResp.Integrations
	require.Greater(len(availableIntegrations), 0)
	require.False(availableIntegrations[0].IsInstalled)
}

func TestLogPipelinesForInstalledSignozIntegrations(t *testing.T) {
	require := require.New(t)

	testDB := utils.NewQueryServiceDBForTests(t)
	utils.CreateTestOrg(t, testDB)

	agentID := valuer.GenerateUUID().String()

	integrationsTB := NewIntegrationsTestBed(t, testDB)
	pipelinesTB := NewLogPipelinesTestBed(t, testDB, agentID)

	availableIntegrationsResp := integrationsTB.GetAvailableIntegrationsFromQS()
	availableIntegrations := availableIntegrationsResp.Integrations
	require.Greater(
		len(availableIntegrations), 0,
		"some integrations should come bundled with SigNoz",
	)

	getPipelinesResp := pipelinesTB.GetPipelinesFromQS()
	require.Equal(
		0, len(getPipelinesResp.Pipelines),
		"There should be no pipelines at the start",
	)

	// Find an available integration that contains a log pipeline
	var testAvailableIntegration *integrations.IntegrationsListItem
	for _, ai := range availableIntegrations {
		details := integrationsTB.GetIntegrationDetailsFromQS(ai.Id)
		require.NotNil(details)
		if len(details.Assets.Logs.Pipelines) > 0 {
			testAvailableIntegration = &ai
			break
		}
	}

	if testAvailableIntegration == nil {
		// None of the built in integrations include a pipeline right now.
		return
	}

	// Installing an integration should add its pipelines to pipelines list
	require.NotNil(testAvailableIntegration)
	require.False(testAvailableIntegration.IsInstalled)
	integrationsTB.RequestQSToInstallIntegration(
		testAvailableIntegration.Id, map[string]interface{}{},
	)

	testIntegration := integrationsTB.GetIntegrationDetailsFromQS(testAvailableIntegration.Id)
	require.NotNil(testIntegration.Installation)
	testIntegrationPipelines := testIntegration.Assets.Logs.Pipelines
	require.Greater(
		len(testIntegrationPipelines), 0,
		"test integration expected to have a pipeline",
	)

	getPipelinesResp = pipelinesTB.GetPipelinesFromQS()
	require.Equal(
		len(testIntegrationPipelines), len(getPipelinesResp.Pipelines),
		"Pipelines for installed integrations should appear in pipelines list",
	)
	lastPipeline := getPipelinesResp.Pipelines[len(getPipelinesResp.Pipelines)-1]
	require.NotNil(integrations.IntegrationIdForPipeline(lastPipeline))
	require.Equal(testIntegration.Id, *integrations.IntegrationIdForPipeline(lastPipeline))

	pipelinesTB.assertPipelinesSentToOpampClient(getPipelinesResp.Pipelines)
	pipelinesTB.assertNewAgentGetsPipelinesOnConnection(getPipelinesResp.Pipelines)

	// After saving a user created pipeline, pipelines response should include
	// both user created pipelines and pipelines for installed integrations.
	postablePipelines := pipelinetypes.PostablePipelines{
		Pipelines: []pipelinetypes.PostablePipeline{
			{
				OrderID: 1,
				Name:    "pipeline1",
				Alias:   "pipeline1",
				Enabled: true,
				Filter: &v3.FilterSet{
					Operator: "AND",
					Items: []v3.FilterItem{
						{
							Key: v3.AttributeKey{
								Key:      "method",
								DataType: v3.AttributeKeyDataTypeString,
								Type:     v3.AttributeKeyTypeTag,
							},
							Operator: "=",
							Value:    "GET",
						},
					},
				},
				Config: []pipelinetypes.PipelineOperator{
					{
						OrderId: 1,
						ID:      "add",
						Type:    "add",
						Field:   "attributes.test",
						Value:   "val",
						Enabled: true,
						Name:    "test add",
					},
				},
			},
		},
	}

	pipelinesTB.PostPipelinesToQS(postablePipelines)

	getPipelinesResp = pipelinesTB.GetPipelinesFromQS()
	require.Equal(1+len(testIntegrationPipelines), len(getPipelinesResp.Pipelines))
	pipelinesTB.assertPipelinesSentToOpampClient(getPipelinesResp.Pipelines)
	pipelinesTB.assertNewAgentGetsPipelinesOnConnection(getPipelinesResp.Pipelines)

	// Reordering integration pipelines should be possible.
	postable := postableFromPipelines(getPipelinesResp.Pipelines)
	slices.Reverse(postable.Pipelines)
	for i := range postable.Pipelines {
		postable.Pipelines[i].OrderID = i + 1
	}

	pipelinesTB.PostPipelinesToQS(postable)

	getPipelinesResp = pipelinesTB.GetPipelinesFromQS()
	firstPipeline := getPipelinesResp.Pipelines[0]
	require.NotNil(integrations.IntegrationIdForPipeline(firstPipeline))
	require.Equal(testIntegration.Id, *integrations.IntegrationIdForPipeline(firstPipeline))

	pipelinesTB.assertPipelinesSentToOpampClient(getPipelinesResp.Pipelines)
	pipelinesTB.assertNewAgentGetsPipelinesOnConnection(getPipelinesResp.Pipelines)

	// enabling/disabling integration pipelines should be possible.
	require.True(firstPipeline.Enabled)

	postable.Pipelines[0].Enabled = false
	pipelinesTB.PostPipelinesToQS(postable)

	getPipelinesResp = pipelinesTB.GetPipelinesFromQS()
	require.Equal(1+len(testIntegrationPipelines), len(getPipelinesResp.Pipelines))

	firstPipeline = getPipelinesResp.Pipelines[0]
	require.NotNil(integrations.IntegrationIdForPipeline(firstPipeline))
	require.Equal(testIntegration.Id, *integrations.IntegrationIdForPipeline(firstPipeline))

	require.False(firstPipeline.Enabled)

	pipelinesTB.assertPipelinesSentToOpampClient(getPipelinesResp.Pipelines)
	pipelinesTB.assertNewAgentGetsPipelinesOnConnection(getPipelinesResp.Pipelines)

	// should not be able to edit integrations pipeline.
	require.Greater(len(postable.Pipelines[0].Config), 0)
	postable.Pipelines[0].Config = []pipelinetypes.PipelineOperator{}
	pipelinesTB.PostPipelinesToQS(postable)

	getPipelinesResp = pipelinesTB.GetPipelinesFromQS()
	require.Equal(1+len(testIntegrationPipelines), len(getPipelinesResp.Pipelines))

	firstPipeline = getPipelinesResp.Pipelines[0]
	require.NotNil(integrations.IntegrationIdForPipeline(firstPipeline))
	require.Equal(testIntegration.Id, *integrations.IntegrationIdForPipeline(firstPipeline))

	require.False(firstPipeline.Enabled)
	require.Greater(len(firstPipeline.Config), 0)

	// should not be able to delete integrations pipeline
	postable.Pipelines = []pipelinetypes.PostablePipeline{postable.Pipelines[1]}
	pipelinesTB.PostPipelinesToQS(postable)

	getPipelinesResp = pipelinesTB.GetPipelinesFromQS()
	require.Equal(1+len(testIntegrationPipelines), len(getPipelinesResp.Pipelines))

	lastPipeline = getPipelinesResp.Pipelines[1]
	require.NotNil(integrations.IntegrationIdForPipeline(lastPipeline))
	require.Equal(testIntegration.Id, *integrations.IntegrationIdForPipeline(lastPipeline))

	// Uninstalling an integration should remove its pipelines
	// from pipelines list in the UI
	integrationsTB.RequestQSToUninstallIntegration(
		testIntegration.Id,
	)
	getPipelinesResp = pipelinesTB.GetPipelinesFromQS()
	require.Equal(
		1, len(getPipelinesResp.Pipelines),
		"Pipelines for uninstalled integrations should get removed from pipelines list",
	)
	pipelinesTB.assertPipelinesSentToOpampClient(getPipelinesResp.Pipelines)
	pipelinesTB.assertNewAgentGetsPipelinesOnConnection(getPipelinesResp.Pipelines)
}

func TestDashboardsForInstalledIntegrationDashboards(t *testing.T) {
	require := require.New(t)

	testDB := utils.NewQueryServiceDBForTests(t)
	integrationsTB := NewIntegrationsTestBed(t, testDB)

	availableIntegrationsResp := integrationsTB.GetAvailableIntegrationsFromQS()
	availableIntegrations := availableIntegrationsResp.Integrations
	require.Greater(
		len(availableIntegrations), 0,
		"some integrations should come bundled with SigNoz",
	)

	dashboards := integrationsTB.GetDashboardsFromQS()
	require.Equal(
		0, len(dashboards),
		"There should be no dashboards at the start",
	)

	// Find an available integration that contains dashboards
	var testAvailableIntegration *integrations.IntegrationsListItem
	for _, ai := range availableIntegrations {
		details := integrationsTB.GetIntegrationDetailsFromQS(ai.Id)
		require.NotNil(details)
		if len(details.Assets.Dashboards) > 0 {
			testAvailableIntegration = &ai
			break
		}
	}
	require.NotNil(testAvailableIntegration)

	// Installing an integration should make its dashboards appear in the dashboard list
	require.False(testAvailableIntegration.IsInstalled)
	tsBeforeInstallation := time.Now().Unix()
	integrationsTB.RequestQSToInstallIntegration(
		testAvailableIntegration.Id, map[string]interface{}{},
	)

	testIntegration := integrationsTB.GetIntegrationDetailsFromQS(testAvailableIntegration.Id)
	require.NotNil(testIntegration.Installation)
	testIntegrationDashboards := testIntegration.Assets.Dashboards
	require.Greater(
		len(testIntegrationDashboards), 0,
		"test integration is expected to have dashboards",
	)

	dashboards = integrationsTB.GetDashboardsFromQS()
	require.Equal(
		len(testIntegrationDashboards), len(dashboards),
		"dashboards for installed integrations should appear in dashboards list",
	)
	require.GreaterOrEqual(dashboards[0].CreatedAt.Unix(), tsBeforeInstallation)
	require.GreaterOrEqual(dashboards[0].UpdatedAt.Unix(), tsBeforeInstallation)

	// Should be able to get installed integrations dashboard by id
	dd := integrationsTB.GetDashboardByIdFromQS(dashboards[0].ID)
	require.GreaterOrEqual(dd.CreatedAt.Unix(), tsBeforeInstallation)
	require.GreaterOrEqual(dd.UpdatedAt.Unix(), tsBeforeInstallation)
	require.Equal(*dd, dashboards[0])

	// Integration dashboards should not longer appear in dashboard list after uninstallation
	integrationsTB.RequestQSToUninstallIntegration(
		testIntegration.Id,
	)
	dashboards = integrationsTB.GetDashboardsFromQS()
	require.Equal(
		0, len(dashboards),
		"dashboards for uninstalled integrations should not appear in dashboards list",
	)
}

type IntegrationsTestBed struct {
	t              *testing.T
	testUser       *types.User
	qsHttpHandler  http.Handler
	mockClickhouse mockhouse.ClickConnMockCommon
	store          sqlstore.SQLStore
	userModule     user.Module
}

func (tb *IntegrationsTestBed) GetAvailableIntegrationsFromQS() *integrations.IntegrationsListResponse {
	result := tb.RequestQS("/api/v1/integrations", nil)

	dataJson, err := json.Marshal(result.Data)
	if err != nil {
		tb.t.Fatalf("could not marshal apiResponse.Data: %v", err)
	}
	var integrationsResp integrations.IntegrationsListResponse
	err = json.Unmarshal(dataJson, &integrationsResp)
	if err != nil {
		tb.t.Fatalf("could not unmarshal apiResponse.Data json into PipelinesResponse")
	}

	return &integrationsResp
}

func (tb *IntegrationsTestBed) GetInstalledIntegrationsFromQS() *integrations.IntegrationsListResponse {
	result := tb.RequestQS("/api/v1/integrations?is_installed=true", nil)

	dataJson, err := json.Marshal(result.Data)
	if err != nil {
		tb.t.Fatalf("could not marshal apiResponse.Data: %v", err)
	}
	var integrationsResp integrations.IntegrationsListResponse
	err = json.Unmarshal(dataJson, &integrationsResp)
	if err != nil {
		tb.t.Fatalf(" could not unmarshal apiResponse.Data json into PipelinesResponse")
	}

	return &integrationsResp
}

func (tb *IntegrationsTestBed) GetIntegrationDetailsFromQS(
	integrationId string,
) *integrations.Integration {
	result := tb.RequestQS(fmt.Sprintf(
		"/api/v1/integrations/%s", integrationId,
	), nil)

	dataJson, err := json.Marshal(result.Data)
	if err != nil {
		tb.t.Fatalf("could not marshal apiResponse.Data: %v", err)
	}
	var integrationResp integrations.Integration
	err = json.Unmarshal(dataJson, &integrationResp)
	if err != nil {
		tb.t.Fatalf("could not unmarshal apiResponse.Data json")
	}

	return &integrationResp
}

func (tb *IntegrationsTestBed) GetIntegrationConnectionStatus(
	integrationId string,
) *integrations.IntegrationConnectionStatus {
	result := tb.RequestQS(fmt.Sprintf(
		"/api/v1/integrations/%s/connection_status", integrationId,
	), nil)

	dataJson, err := json.Marshal(result.Data)
	if err != nil {
		tb.t.Fatalf("could not marshal apiResponse.Data: %v", err)
	}
	var connectionStatus integrations.IntegrationConnectionStatus
	err = json.Unmarshal(dataJson, &connectionStatus)
	if err != nil {
		tb.t.Fatalf("could not unmarshal apiResponse.Data json")
	}

	return &connectionStatus
}

func (tb *IntegrationsTestBed) RequestQSToInstallIntegration(
	integrationId string, config map[string]interface{},
) {
	request := integrations.InstallIntegrationRequest{
		IntegrationId: integrationId,
		Config:        config,
	}
	tb.RequestQS("/api/v1/integrations/install", request)
}

func (tb *IntegrationsTestBed) RequestQSToUninstallIntegration(
	integrationId string,
) {
	request := integrations.UninstallIntegrationRequest{
		IntegrationId: integrationId,
	}
	tb.RequestQS("/api/v1/integrations/uninstall", request)
}

func (tb *IntegrationsTestBed) GetDashboardsFromQS() []dashboardtypes.Dashboard {
	result := tb.RequestQS("/api/v1/dashboards", nil)

	dataJson, err := json.Marshal(result.Data)
	if err != nil {
		tb.t.Fatalf("could not marshal apiResponse.Data: %v", err)
	}

	dashboards := []dashboardtypes.Dashboard{}
	err = json.Unmarshal(dataJson, &dashboards)
	if err != nil {
		tb.t.Fatalf(" could not unmarshal apiResponse.Data json into dashboards")
	}

	return dashboards
}

func (tb *IntegrationsTestBed) GetDashboardByIdFromQS(dashboardUuid string) *dashboardtypes.Dashboard {
	result := tb.RequestQS(fmt.Sprintf("/api/v1/dashboards/%s", dashboardUuid), nil)

	dataJson, err := json.Marshal(result.Data)
	if err != nil {
		tb.t.Fatalf("could not marshal apiResponse.Data: %v", err)
	}

	dashboard := dashboardtypes.Dashboard{}
	err = json.Unmarshal(dataJson, &dashboard)
	if err != nil {
		tb.t.Fatalf(" could not unmarshal apiResponse.Data json into dashboards")
	}

	return &dashboard
}

func (tb *IntegrationsTestBed) RequestQS(
	path string,
	postData interface{},
) *app.ApiResponse {
	req, err := AuthenticatedRequestForTest(
		tb.userModule, tb.testUser, path, postData,
	)
	if err != nil {
		tb.t.Fatalf("couldn't create authenticated test request: %v", err)
	}

	result, err := HandleTestRequest(tb.qsHttpHandler, req, 200)
	if err != nil {
		tb.t.Fatalf("test request failed: %v", err)
	}
	return result
}

func (tb *IntegrationsTestBed) mockLogQueryResponse(logsInResponse []model.SignozLog) {
	addLogsQueryExpectation(tb.mockClickhouse, logsInResponse)
}

func (tb *IntegrationsTestBed) mockMetricStatusQueryResponse(expectation *model.MetricStatus) {
	cols := []mockhouse.ColumnType{}
	cols = append(cols, mockhouse.ColumnType{Type: "String", Name: "metric_name"})
	cols = append(cols, mockhouse.ColumnType{Type: "String", Name: "labels"})
	cols = append(cols, mockhouse.ColumnType{Type: "Int64", Name: "unix_milli"})

	values := [][]any{}
	if expectation != nil {
		rowValues := []any{}

		rowValues = append(rowValues, expectation.MetricName)

		labelsJson, err := json.Marshal(expectation.LastReceivedLabels)
		require.Nil(tb.t, err)
		rowValues = append(rowValues, labelsJson)

		rowValues = append(rowValues, expectation.LastReceivedTsMillis)

		values = append(values, rowValues)
	}

	tb.mockClickhouse.ExpectQuery(
		`SELECT.*from.*signoz_metrics.*`,
	).WillReturnRows(mockhouse.NewRows(cols, values))
}

// testDB can be injected for sharing a DB across multiple integration testbeds.
func NewIntegrationsTestBed(t *testing.T, testDB sqlstore.SQLStore) *IntegrationsTestBed {
	if testDB == nil {
		testDB = utils.NewQueryServiceDBForTests(t)
	}

	controller, err := integrations.NewController(testDB)
	if err != nil {
		t.Fatalf("could not create integrations controller: %v", err)
	}

	reader, mockClickhouse := NewMockClickhouseReader(t, testDB)
	mockClickhouse.MatchExpectationsInOrder(false)

	cloudIntegrationsController, err := cloudintegrations.NewController(testDB)
	if err != nil {
		t.Fatalf("could not create cloud integrations controller: %v", err)
	}

	providerSettings := instrumentationtest.New().ToProviderSettings()
	sharder, err := noopsharder.New(context.TODO(), providerSettings, sharder.Config{})
	require.NoError(t, err)
	orgGetter := implorganization.NewGetter(implorganization.NewStore(testDB), sharder)
	alertmanager, err := signozalertmanager.New(context.TODO(), providerSettings, alertmanager.Config{Signoz: alertmanager.Signoz{PollInterval: 10 * time.Second, Config: alertmanagerserver.NewConfig()}}, testDB, orgGetter)
	require.NoError(t, err)
	jwt := authtypes.NewJWT("", 1*time.Hour, 1*time.Hour)
	emailing := emailingtest.New()
	analytics := analyticstest.New()
	modules := signoz.NewModules(testDB, jwt, emailing, providerSettings, orgGetter, alertmanager, analytics)
	handlers := signoz.NewHandlers(modules)

	apiHandler, err := app.NewAPIHandler(app.APIHandlerOpts{
		Reader:                      reader,
		IntegrationsController:      controller,
		CloudIntegrationsController: cloudIntegrationsController,
		Signoz: &signoz.SigNoz{
			Modules:  modules,
			Handlers: handlers,
		},
	})
	if err != nil {
		t.Fatalf("could not create a new ApiHandler: %v", err)
	}

	router := app.NewRouter()
	router.Use(middleware.NewAuth(jwt, []string{"Authorization", "Sec-WebSocket-Protocol"}, sharder, instrumentationtest.New().Logger()).Wrap)
	am := middleware.NewAuthZ(instrumentationtest.New().Logger())
	apiHandler.RegisterRoutes(router, am)
	apiHandler.RegisterIntegrationRoutes(router, am)

	user, apiErr := createTestUser(modules.OrgSetter, modules.User)
	if apiErr != nil {
		t.Fatalf("could not create a test user: %v", apiErr)
	}

	return &IntegrationsTestBed{
		t:              t,
		testUser:       user,
		qsHttpHandler:  router,
		mockClickhouse: mockClickhouse,
		store:          testDB,
		userModule:     modules.User,
	}
}

func postableFromPipelines(gettablePipelines []pipelinetypes.GettablePipeline) pipelinetypes.PostablePipelines {
	result := pipelinetypes.PostablePipelines{}

	for _, p := range gettablePipelines {
		postable := pipelinetypes.PostablePipeline{
			ID:      p.ID.StringValue(),
			OrderID: p.OrderID,
			Name:    p.Name,
			Alias:   p.Alias,
			Enabled: p.Enabled,
			Config:  p.Config,
		}

		if p.Description != "" {
			postable.Description = p.Description
		}

		if p.Filter != nil {
			postable.Filter = p.Filter
		}

		result.Pipelines = append(result.Pipelines, postable)
	}

	return result
}
