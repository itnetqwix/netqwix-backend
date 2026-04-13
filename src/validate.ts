import { model } from './model';
export class validator {
    public validate( args: model ) {
        return function( req, res ,next ) {
            model.getModel( args, req.body, req.params ).then( m2 => {
                //  getting validated model
                req.model = m2;
                next();
            }).catch( err => {                
                const error = err.length > 0 && err[0].constraints ?
                  err[0].constraints[`${Object.keys(err[0].constraints)[0]}`] : err;
                 return res.status(400).json({ error, code: 400 });
            });
        }
    }
}