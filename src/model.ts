import { validate } from "class-validator";

export class model {
    public static async getModel( model: any, body: any, query ?: any ): Promise<model> {
        // console.log( 'getModel ', body );
        try {
            const m2 = new model(body, query );
            // console.log( 'M2 ', m2 );
            const error = await validate(m2);
                if (error.length ) {
                    throw error;
                }
            return m2;
        } catch(err) {
            throw err;
        }
    }
}