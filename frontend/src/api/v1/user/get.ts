import axios from 'api';
import { ErrorResponseHandlerV2 } from 'api/ErrorResponseHandlerV2';
import { AxiosError } from 'axios';
import { ErrorV2Resp, SuccessResponseV2 } from 'types/api';
import { UserResponse } from 'types/api/user/getUser';
import { PayloadProps } from 'types/api/user/getUsers';

const getAll = async (): Promise<SuccessResponseV2<UserResponse[]>> => {
	try {
		const response = await axios.get<PayloadProps>(`/user`);

		return {
			httpStatusCode: response.status,
			data: response.data.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
};

export default getAll;
